import { spawn, type SpawnOptions } from 'child_process';
import { buildArgs, type LaunchOptions } from './ProcessArgs';
import type { ChannelRouter } from './ChannelRouter';
import { StreamJsonParser } from './StreamJsonParser';

export interface ILogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

/** LaunchOptions extended with the optional wrapper binary path. */
export interface ProcessLaunchOptions extends LaunchOptions {
  wrapper?: string;
}

interface ProcessHandle {
  stdin: { write(data: string): unknown; writable: boolean } | null;
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown };
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(signal?: string): unknown;
}

type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => ProcessHandle;

/**
 * Manages the lifecycle of claude CLI subprocesses, one per channelId.
 *
 * Each channel gets its own process. stdout is piped through StreamJsonParser
 * and routed to the ChannelRouter. stdin accepts JSON-line messages.
 */
export class ClaudeProcessManager {
  private readonly processes = new Map<string, ProcessHandle>();
  private readonly swapping = new Set<string>();

  constructor(
    private readonly binaryProvider: () => Promise<string>,
    private readonly router: ChannelRouter,
    private readonly logger: ILogger,
    private readonly spawnFn: SpawnFn = spawn as unknown as SpawnFn,
  ) {}

  /**
   * Spawn a new claude process for the given channelId. Throws if already active.
   * Async because the pinned binary is downloaded on first use (cached after) —
   * a per-launch `wrapper` override skips the provider.
   */
  async spawnClaude(
    channelId: string,
    options: ProcessLaunchOptions,
    cwd?: string,
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    if (this.processes.has(channelId)) {
      throw new Error(`Channel "${channelId}" is already active`);
    }

    const proc = await this._launchProcess(channelId, options, cwd, env);
    this.processes.set(channelId, proc);
  }

  /**
   * Atomically replace the process behind an already-active channelId with a
   * freshly spawned one. Guarantees, across the whole swap window (including
   * the `await` inside `_launchProcess` while the binary resolves — which can
   * be a real download on first use, per spawnClaude's doc comment):
   *
   *  - `this.processes` never observes a gap for that key.
   *  - The channel's router registration is never torn down. Without this,
   *    if the OLD process's 'close'/'error' event fires while the new one is
   *    still being launched, `_cleanupIfCurrent` would see the old process as
   *    still "current" (the map hasn't flipped yet) and call
   *    `router.unregister(channelId)` — and nothing ever re-registers it, so
   *    the swapped-in process's stdout would be silently dropped forever by
   *    `ChannelRouter.route()`'s no-op-on-unknown-handler behavior.
   *
   * `swapping` guards exactly that window: it's set before the launch begins
   * and cleared immediately after `this.processes.set()` — not after
   * `oldProc.kill()` — because once the map holds the new process, the
   * existing identity check in `_cleanupIfCurrent` already correctly no-ops
   * for the old process's later-arriving close/error event; the flag must
   * not be held any longer than the window it actually protects.
   *
   * Unlike spawnClaude, this does not throw if the channel is already active
   * — replacing an active channel is the whole point. The old process (if
   * any) is killed after the new one is registered.
   */
  async swapChannel(
    channelId: string,
    options: ProcessLaunchOptions,
    cwd?: string,
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    const oldProc = this.processes.get(channelId);
    this.swapping.add(channelId);

    try {
      const proc = await this._launchProcess(channelId, options, cwd, env);
      this.processes.set(channelId, proc);
    } finally {
      this.swapping.delete(channelId);
    }

    if (oldProc !== undefined) {
      oldProc.kill();
    }
  }

  /**
   * Spawn a process for channelId and wire up its stdout parser and
   * close/error handlers. Does not touch `this.processes` — callers decide
   * when/whether to register the returned handle, which is what keeps the
   * `await` (binary resolution) outside the atomic map-swap window in both
   * spawnClaude and swapChannel.
   */
  private async _launchProcess(
    channelId: string,
    options: ProcessLaunchOptions,
    cwd?: string,
    env?: NodeJS.ProcessEnv,
  ): Promise<ProcessHandle> {
    const binary = options.wrapper ?? (await this.binaryProvider());
    const args = buildArgs(options);

    const proc = this.spawnFn(binary, args, {
      cwd: cwd ?? process.cwd(),
      env: env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const parser = new StreamJsonParser(
      (event) => this.router.route(channelId, event),
      (line) => this.logger.warn(`[channel:${channelId}] bad JSON: ${line}`),
    );

    proc.stdout.on('data', (chunk: Buffer) => parser.feed(chunk.toString()));

    proc.on('close', (code: unknown) => {
      this.logger.info(`[channel:${channelId}] closed (code=${String(code)})`);
      this._cleanupIfCurrent(channelId, proc);
    });

    proc.on('error', (err: unknown) => {
      this.logger.error(`[channel:${channelId}] process error`, err);
      this._cleanupIfCurrent(channelId, proc);
    });

    return proc;
  }

  /** Write a JSON line to the channel's stdin. No-op if channel is inactive or stdin not writable. */
  writeToChannel(channelId: string, data: unknown): void {
    const proc = this.processes.get(channelId);
    if (proc === undefined) return;
    if (proc.stdin === null || !proc.stdin.writable) return;
    proc.stdin.write(JSON.stringify(data) + '\n');
  }

  /**
   * Send a user turn to the channel's claude process.
   *
   * The CLI's `--input-format stream-json` mode requires each user turn as an
   * NDJSON line whose `message` is a full Anthropic message object
   * (`{ role, content }`) — NOT a bare string. A bare string makes the CLI emit
   * `Error: Expected message role 'user', got 'undefined'` and produce no
   * response, so this envelope is the contract the whole send path depends on.
   */
  sendUserMessage(channelId: string, text: string): void {
    this.writeToChannel(channelId, { type: 'user', message: { role: 'user', content: text } });
  }

  /** Send SIGINT to interrupt the channel's running command. No-op if inactive. */
  interruptClaude(channelId: string): void {
    this.processes.get(channelId)?.kill('SIGINT');
  }

  /** Kill and clean up a channel's process. No-op if inactive. */
  closeChannel(channelId: string): void {
    const proc = this.processes.get(channelId);
    if (proc === undefined) return;
    proc.kill();
    this._cleanupIfCurrent(channelId, proc);
  }

  /** Kill all active processes and clean up. */
  dispose(): void {
    for (const channelId of Array.from(this.processes.keys())) {
      this.closeChannel(channelId);
    }
  }

  /** Returns true if a channelId has an active process. */
  hasChannel(channelId: string): boolean {
    return this.processes.has(channelId);
  }

  /**
   * Cleanup a process's map/router entries, but only if `proc` is still the
   * entry registered for `channelId`. A process's close/error handlers are
   * bound at spawn time; if that channelId has since been reassigned to a
   * different process (see swapChannel), the old handler must not tear down
   * the new process's registration.
   *
   * Also no-ops while a swap is in flight for this channelId, even though
   * the identity check above would otherwise say "still current" — the old
   * process is still the map entry until swapChannel's `this.processes.set()`
   * runs, so without this guard a close/error firing mid-swap (e.g. while
   * still awaiting binary resolution) would unregister the channel from the
   * router. Nothing ever re-registers it, so the incoming process's stdout
   * would be silently dropped forever. swapChannel owns this channel's
   * lifecycle for the duration of the flag.
   */
  private _cleanupIfCurrent(channelId: string, proc: ProcessHandle): void {
    if (this.processes.get(channelId) !== proc) return;
    if (this.swapping.has(channelId)) return;
    this.processes.delete(channelId);
    this.router.unregister(channelId);
  }
}
