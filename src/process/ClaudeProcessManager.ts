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
  private readonly swapping = new Map<string, number>();
  private readonly closeRequested = new Set<string>();
  private swapTokenSeq = 0;
  // Tracks processes whose 'close'/'error' handler has already fired (i.e.
  // they exited on their own) but which the `swapping` guard suppressed from
  // real cleanup at the time — see swapChannel()'s failure-path handling of
  // `oldProc`. A WeakSet needs no manual pruning: entries for GC'd processes
  // simply vanish, and swapChannel() deletes an entry itself once it acts on
  // it.
  private readonly exitedProcesses = new WeakSet<ProcessHandle>();

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
   * `swapping` guards exactly that window: it holds a token for this call,
   * set before the launch begins and cleared right after `this.processes.set()`
   * — not after `oldProc.kill()` — because once the map holds the new
   * process, the existing identity check in `_cleanupIfCurrent` already
   * correctly no-ops for the old process's later-arriving close/error event;
   * the guard must not be held any longer than the window it actually
   * protects.
   *
   * The token (rather than a plain per-channel flag) makes the guard itself
   * safe against being cleared out from under an overlapping call: each call
   * only clears the guard if its own token is still the one stored for that
   * channelId, so a second, later call for the same channel doesn't have its
   * still-in-flight protection window silently dropped by the first call's
   * completion. This does not make overlapping swaps fully safe in general —
   * see `session-relay-design-yre` for the remaining gaps (a leaked process
   * on a successful overlap, a stolen close-request on failure).
   *
   * If `_launchProcess` throws (the binary can't be resolved, or the launch
   * otherwise fails), `oldProc` is handled based on its state at that point:
   *
   *  - If `oldProc` had already exited on its own during the swap window
   *    (its 'close'/'error' handler fired but `_cleanupIfCurrent` no-opped
   *    because `swapping` was held), nothing will ever re-trigger cleanup
   *    for that now-stale map/router entry — events don't refire — so this
   *    method tears it down itself here, mirroring `closeChannel()`.
   *  - If a close was explicitly requested for this channel while the swap
   *    was in flight (deferred by `closeChannel()` — see its doc comment),
   *    that request is honored here: `oldProc` is killed and torn down, even
   *    if it was still healthy, because the caller asked for the channel to
   *    go away, not for a failed swap attempt to leave it running.
   *  - Otherwise, `oldProc` is still healthy and no close was requested — it
   *    is left completely alone: still the registered, working process for
   *    the channel. Only the swap attempt failed; the session itself is
   *    unaffected. Killing a healthy process here would silently end a
   *    working session with no notification path (no
   *    `MessageBroker.handleCloseChannel` call) and could drop messages
   *    queued during the swap.
   *
   * Either way, the launch error is rethrown so the caller knows the swap
   * attempt failed.
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
    const token = ++this.swapTokenSeq;
    this.swapping.set(channelId, token);

    let launchFailed = false;
    let launchError: unknown;
    try {
      const proc = await this._launchProcess(channelId, options, cwd, env);
      this.processes.set(channelId, proc);
    } catch (err) {
      launchFailed = true;
      launchError = err;
    } finally {
      if (this.swapping.get(channelId) === token) {
        this.swapping.delete(channelId);
      }
    }

    if (launchFailed) {
      // The swap never landed. If `oldProc` already exited on its own during
      // the swap window, or a close was explicitly requested for this
      // channel while the swap was in flight, nothing else will ever clean
      // it up — do it here, the same way closeChannel() would. Otherwise
      // `oldProc` is still healthy and no close was requested, so leave it
      // completely alone: the swap attempt failed, but the session itself is
      // unaffected, and killing it here would silently end a working session
      // (see the swapChannel doc comment above for why).
      //
      // Must run after the finally block above, not inside a catch: at the
      // point a catch block would run, `swapping` still holds this call's
      // token, and `_cleanupIfCurrent()` no-ops while that guard is set (see
      // the swapChannel doc comment above). Moving this cleanup into `catch`
      // would look equivalent but silently break — `_cleanupIfCurrent(channelId,
      // oldProc)` below would no-op instead of actually tearing the channel down.
      if (oldProc !== undefined) {
        const alreadyExited = this.exitedProcesses.has(oldProc);
        // A close explicitly requested during the swap window (deferred by
        // closeChannel(), see its doc comment) must still be honored even
        // though the swap itself failed — the caller asked for the channel
        // to go away, not for the failed swap attempt to leave it running.
        const closeWasRequested = this.closeRequested.has(channelId);
        if (alreadyExited || closeWasRequested) {
          if (!alreadyExited) {
            oldProc.kill();
          }
          this._cleanupIfCurrent(channelId, oldProc);
          this.exitedProcesses.delete(oldProc);
        }
      }
      this.closeRequested.delete(channelId);
      throw launchError instanceof Error ? launchError : new Error(String(launchError));
    }

    // A close requested while the swap was in flight was deferred (see
    // closeChannel()) rather than acted on immediately, since the process
    // reference wasn't stable during that window. Act on it for real now,
    // against the newly-installed process.
    if (this.closeRequested.has(channelId)) {
      this.closeRequested.delete(channelId);
      this.closeChannel(channelId);
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

    proc.stdout.on('data', (chunk: Buffer) => {
      // A superseded process (post-swapChannel) can still have buffered
      // stdout to flush after this.processes has already moved on to the
      // new process. ChannelRouter.route() dispatches purely by channelId,
      // so without this identity check that trailing output would be
      // routed indistinguishably from the new process's real output.
      if (this.processes.get(channelId) !== proc) return;
      parser.feed(chunk.toString());
    });

    proc.on('close', (code: unknown) => {
      this.logger.info(`[channel:${channelId}] closed (code=${String(code)})`);
      this.exitedProcesses.add(proc);
      this._cleanupIfCurrent(channelId, proc);
    });

    proc.on('error', (err: unknown) => {
      this.logger.error(`[channel:${channelId}] process error`, err);
      this.exitedProcesses.add(proc);
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

  /**
   * Kill and clean up a channel's process. No-op if inactive.
   *
   * Deferred, not dropped, while a swap is in flight for this channelId: the
   * process reference isn't stable during that window (see swapChannel's doc
   * comment), so acting immediately here could kill the old process while
   * leaving the map entry in place for `swapping`-guarded cleanup to skip —
   * and the swap would then go on to install a fresh process anyway,
   * resurrecting a channel the caller explicitly closed. Instead, record the
   * request; once the swap settles, swapChannel replays it for real against
   * the newly-installed process on success, or (if the launch failed)
   * swapChannel's own failure-path handling honors it directly: it kills and
   * tears down the old process because a close was explicitly requested —
   * independently of whether that old process had already exited on its own
   * (see swapChannel's doc comment for that separate case). A still-healthy
   * old process for which no close was requested is left running untouched
   * in that failure path, since only the swap attempt itself failed.
   */
  closeChannel(channelId: string): void {
    if (this.swapping.has(channelId)) {
      this.closeRequested.add(channelId);
      return;
    }
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
   * would be silently dropped forever. Whichever swapChannel() call's token
   * is currently stored owns this channel's lifecycle for the duration of
   * that entry — see swapChannel's doc comment for why a token, not a plain
   * flag, is needed here.
   */
  private _cleanupIfCurrent(channelId: string, proc: ProcessHandle): void {
    if (this.processes.get(channelId) !== proc) return;
    if (this.swapping.has(channelId)) return;
    this.processes.delete(channelId);
    this.router.unregister(channelId);
  }
}
