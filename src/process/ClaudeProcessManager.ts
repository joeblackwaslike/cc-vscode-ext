import { spawn, type SpawnOptions } from 'child_process';
import { buildArgs, type LaunchOptions } from './ProcessArgs';
import { resolveBinaryPath } from '../utils/platform';
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

  constructor(
    private readonly extensionPath: string,
    private readonly router: ChannelRouter,
    private readonly logger: ILogger,
    private readonly spawnFn: SpawnFn = spawn as unknown as SpawnFn,
  ) {}

  /** Spawn a new claude process for the given channelId. Throws if already active. */
  spawnClaude(
    channelId: string,
    options: ProcessLaunchOptions,
    cwd?: string,
    env?: NodeJS.ProcessEnv,
  ): void {
    if (this.processes.has(channelId)) {
      throw new Error(`Channel "${channelId}" is already active`);
    }

    const binary = resolveBinaryPath(this.extensionPath, options.wrapper);
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
      this._cleanup(channelId);
    });

    proc.on('error', (err: unknown) => {
      this.logger.error(`[channel:${channelId}] process error`, err);
      this._cleanup(channelId);
    });

    this.processes.set(channelId, proc);
  }

  /** Write a JSON line to the channel's stdin. No-op if channel is inactive or stdin not writable. */
  writeToChannel(channelId: string, data: unknown): void {
    const proc = this.processes.get(channelId);
    if (proc === undefined) return;
    if (proc.stdin === null || !proc.stdin.writable) return;
    proc.stdin.write(JSON.stringify(data) + '\n');
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
    this._cleanup(channelId);
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

  private _cleanup(channelId: string): void {
    this.processes.delete(channelId);
    this.router.unregister(channelId);
  }
}
