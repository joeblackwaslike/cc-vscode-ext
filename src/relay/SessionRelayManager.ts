import type { ProcessLaunchOptions } from '../process/ClaudeProcessManager';
import type { ILogger } from '../process/ClaudeProcessManager';
import type { ContextUsage } from '../types/ipc';
import type { ClaudeStreamEvent } from '../types/process';
import { HANDOFF_SYSTEM_PROMPT } from './handoffPrompt';

const DEFAULT_THRESHOLD = 70;

export interface IRelayProcessManager {
  sendUserMessage(channelId: string, text: string): void;
  swapChannel(channelId: string, options: ProcessLaunchOptions, cwd?: string): Promise<void>;
}

export interface IRelayControlRequestManager {
  hasPending(channelId: string): boolean;
}

export interface IRelayViewManager {
  broadcastMessage(msg: {
    type: 'relay_started';
    channelId: string;
    fromSessionId?: string | undefined;
    toSessionId?: string | undefined;
  }): void;
}

interface LaunchInfo {
  options: ProcessLaunchOptions;
  cwd: string | undefined;
}

interface CapturedResult {
  text: string;
  sessionId: string | undefined;
}

interface PendingCapture {
  resolve: (result: CapturedResult) => void;
  reject: (err: Error) => void;
}

/**
 * Watches per-channel context usage and, once a channel crosses its relay
 * threshold, swaps that channel to a fresh claude process seeded with a
 * distilled handoff — pre-empting context rot instead of reacting to it.
 * See docs/session-relay-design.md for the full design.
 */
export class SessionRelayManager {
  private readonly launches = new Map<string, LaunchInfo>();
  private readonly thresholds = new Map<string, number>();
  private readonly relaying = new Set<string>();
  private readonly pendingCaptures = new Map<string, PendingCapture>();
  private defaultThreshold = DEFAULT_THRESHOLD;

  constructor(
    private readonly processManager: IRelayProcessManager,
    private readonly control: IRelayControlRequestManager,
    private readonly viewManager: IRelayViewManager,
    private readonly logger: ILogger,
  ) {}

  /** Record how a channel was launched, so a later relay knows how to respawn it. */
  registerLaunch(channelId: string, options: ProcessLaunchOptions, cwd?: string): void {
    this.launches.set(channelId, { options, cwd });
  }

  /** Forget a channel entirely — called when the channel is explicitly closed. */
  unregisterChannel(channelId: string): void {
    this.launches.delete(channelId);
    this.thresholds.delete(channelId);
    this.relaying.delete(channelId);
    const pending = this.pendingCaptures.get(channelId);
    if (pending) {
      this.pendingCaptures.delete(channelId);
      pending.reject(new Error(`channel "${channelId}" closed`));
    }
  }

  getThreshold(channelId?: string): number {
    if (channelId === undefined) return this.defaultThreshold;
    return this.thresholds.get(channelId) ?? this.defaultThreshold;
  }

  setThreshold(threshold: number, channelId?: string): void {
    if (channelId === undefined) {
      this.defaultThreshold = threshold;
    } else {
      this.thresholds.set(channelId, threshold);
    }
  }

  /** Called for every context_usage refresh; starts a relay once past threshold. */
  onContextUsage(channelId: string, usage: ContextUsage): void {
    if (!this.launches.has(channelId)) return;
    if (usage.percentage < this.getThreshold(channelId)) return;
    void this.relay(channelId);
  }

  /**
   * Called by MessageBroker for every `result` stream event on a channel.
   * Only meaningful while a relay has a capture pending for that channel —
   * a no-op the rest of the time.
   */
  handleStreamEvent(channelId: string, event: ClaudeStreamEvent): void {
    if (event.type !== 'result') return;
    const pending = this.pendingCaptures.get(channelId);
    if (!pending) return;
    this.pendingCaptures.delete(channelId);

    const sessionId = typeof event.session_id === 'string' ? event.session_id : undefined;
    if (event.subtype === 'success' && typeof event.result === 'string') {
      pending.resolve({ text: event.result, sessionId });
    } else {
      pending.reject(new Error(`relay turn did not succeed (subtype=${String(event.subtype)})`));
    }
  }

  private captureNextResult(channelId: string): Promise<CapturedResult> {
    return new Promise((resolve, reject) => {
      this.pendingCaptures.set(channelId, { resolve, reject });
    });
  }

  private async relay(channelId: string): Promise<void> {
    if (this.relaying.has(channelId)) return;
    if (this.control.hasPending(channelId)) return;
    const launch = this.launches.get(channelId);
    if (!launch) return;

    this.relaying.add(channelId);
    try {
      const handoffCapture = this.captureNextResult(channelId);
      this.processManager.sendUserMessage(channelId, HANDOFF_SYSTEM_PROMPT);
      const handoff = await handoffCapture;

      const freshOptions: ProcessLaunchOptions = { ...launch.options };
      delete freshOptions.resume;
      await this.processManager.swapChannel(channelId, freshOptions, launch.cwd);

      const reseedCapture = this.captureNextResult(channelId);
      this.processManager.sendUserMessage(channelId, handoff.text);
      const reseeded = await reseedCapture;

      this.viewManager.broadcastMessage({
        type: 'relay_started',
        channelId,
        fromSessionId: handoff.sessionId,
        toSessionId: reseeded.sessionId,
      });
    } catch (err) {
      this.logger.error(`[SessionRelayManager] relay failed for channel "${channelId}"`, err);
    } finally {
      this.relaying.delete(channelId);
    }
  }
}
