/**
 * Tracks the CLI's `can_use_tool` control requests. The CLI writes
 *   {type:'control_request', request_id, request:{subtype:'can_use_tool', tool_name, input, ...}}
 * to stdout and blocks until we reply on stdin with
 *   {type:'control_response', response:{subtype:'success', request_id, response: decision}}
 *
 * One instance is shared by every webview's broker: it holds the pending
 * prompts, answers the CLI, and broadcasts prompt state to all webviews.
 */

import type { PermissionMode } from './ProcessArgs';
import type { ApproveMode } from './ProcessArgs';
import type {
  PermissionDecision,
  PermissionRequest,
  PermissionUpdate,
  ToWebviewMessage,
} from '../types/ipc';

export interface CanUseToolEvent {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'can_use_tool';
    tool_name: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    permission_suggestions?: PermissionUpdate[];
    description?: string;
  };
}

export function isCanUseToolRequest(event: unknown): event is CanUseToolEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as { type?: unknown; request_id?: unknown; request?: { subtype?: unknown; tool_name?: unknown } };
  return (
    e.type === 'control_request' &&
    typeof e.request_id === 'string' &&
    e.request?.subtype === 'can_use_tool' &&
    typeof e.request.tool_name === 'string'
  );
}

interface PermissionRequestsDeps {
  write(channelId: string, data: unknown): boolean;
  broadcast(msg: ToWebviewMessage): void;
  log?(message: string): void;
  /** Mode the ExitPlanMode approve button switches to; defaults to acceptEdits. */
  getApproveMode?: () => ApproveMode;
  /** Mode offered as the new default after plan approval; `off` disables the offer. */
  getOfferMode?: () => ApproveMode | 'off';
  /** The default permission mode currently in effect. */
  getResolvedDefault?: () => PermissionMode;
  /** Tell the user a decision never reached the CLI (the channel is no longer writable). */
  reportError?(channelId: string, message: string): void;
}

interface ChannelMode {
  current: PermissionMode | undefined;
  beforePlan: PermissionMode | undefined;
}

/** Shown when a configured bypass plan-exit fallback is downgraded because the session lacks the skip-permissions flag. */
export const BYPASS_DOWNGRADE_NOTICE =
  'Bypass permissions is unavailable because this session was launched without the dangerous-skip flag; using Accept edits.';

export class PermissionRequests {
  private readonly pending = new Map<string, PermissionRequest>();
  private readonly modes = new Map<string, ChannelMode>();
  private readonly bypassFlags = new Map<string, boolean>();
  private readonly offers = new Map<string, PermissionMode>();

  constructor(private readonly deps: PermissionRequestsDeps) {}

  register(channelId: string, event: CanUseToolEvent): PermissionRequest {
    const { request } = event;
    const configured = this.deps.getApproveMode?.() ?? 'acceptEdits';
    const downgraded = configured === 'bypassPermissions' && !this.bypassAllowed(channelId);
    const req: PermissionRequest = {
      channelId,
      requestId: event.request_id,
      toolName: request.tool_name,
      toolUseId: request.tool_use_id,
      input: request.input ?? {},
      suggestions: request.permission_suggestions,
      description: request.description,
      priorMode: request.tool_name === 'ExitPlanMode' ? this.modes.get(channelId)?.beforePlan : undefined,
      approveMode: downgraded ? 'acceptEdits' : configured,
      approveNotice: downgraded
        ? BYPASS_DOWNGRADE_NOTICE
        : undefined,
    };
    this.pending.set(req.requestId, req);
    this.deps.broadcast({ type: 'permission_request', request: req });
    return req;
  }

  respond(channelId: string, requestId: string, decision: PermissionDecision): boolean {
    const req = this.pending.get(requestId);
    if (!req || req.channelId !== channelId) {
      this.deps.log?.(`[permissions] reply ignored: no pending request ${requestId} on ${channelId}`);
      return false;
    }
    this.pending.delete(requestId);
    if (!this.writeDecision(channelId, requestId, decision)) {
      this.deps.log?.(`[permissions] reply to ${requestId} on ${channelId} was dropped (channel not writable); cancelling the prompt`);
      this.deps.reportError?.(
        channelId,
        'Your answer could not be sent because the Claude connection is unavailable. Resend your message to continue.'
      );
      this.deps.broadcast({
        type: 'permission_cancelled',
        channelId,
        requestIds: [requestId],
        toolUseIds: req.toolUseId ? [req.toolUseId] : [],
      });
      return false;
    }
    this.deps.broadcast({
      type: 'permission_resolved',
      channelId,
      requestId,
      toolUseId: req.toolUseId,
      decision,
    });
    this.offerDefaultMode(req, decision);
    return true;
  }

  private offerDefaultMode(req: PermissionRequest, decision: PermissionDecision): void {
    if (req.toolName !== 'ExitPlanMode' || decision.behavior !== 'allow' || req.approveNotice !== undefined) return;
    const chosen = decision.updatedPermissions?.find((u) => u.type === 'setMode');
    if (chosen?.mode !== req.approveMode) return;
    const mode = this.deps.getOfferMode?.() ?? 'off';
    const currentDefault = this.deps.getResolvedDefault?.();
    if (mode === 'off' || currentDefault === undefined || mode === currentDefault) return;
    this.offers.set(req.channelId, mode);
    this.deps.broadcast({ type: 'default_mode_offer', channelId: req.channelId, mode, currentDefault });
  }

  /** Claims the channel's outstanding default-mode offer if `mode` matches it; each offer is answered once. */
  takeOffer(channelId: string, mode: PermissionMode): boolean {
    const offered = this.offers.get(channelId);
    if (offered !== mode) {
      this.deps.log?.(`[permissions] default-mode answer ${mode} on ${channelId} ignored: outstanding offer is ${offered ?? 'none'}`);
      return false;
    }
    this.offers.delete(channelId);
    return true;
  }

  /** Forgets a closed channel's outstanding offer, mode, and bypass flag, and cancels its pending prompts. */
  closeChannel(channelId: string): void {
    this.offers.delete(channelId);
    this.modes.delete(channelId);
    this.bypassFlags.delete(channelId);
    this.cancelChannel(channelId);
  }

  denyWithoutPrompt(channelId: string, event: CanUseToolEvent, message: string): void {
    if (!this.writeDecision(channelId, event.request_id, { behavior: 'deny', message })) {
      this.deps.log?.(`[permissions] auto-deny of ${event.request_id} on ${channelId} was dropped; the CLI stays blocked on it`);
    }
  }

  cancelChannel(channelId: string): void {
    const dropped = [...this.pending.values()].filter((r) => r.channelId === channelId);
    if (dropped.length === 0) return;
    for (const r of dropped) this.pending.delete(r.requestId);
    this.deps.broadcast({
      type: 'permission_cancelled',
      channelId,
      requestIds: dropped.map((r) => r.requestId),
      toolUseIds: dropped.flatMap((r) => (r.toolUseId ? [r.toolUseId] : [])),
    });
  }

  cancel(channelId: string, requestId: string): void {
    const req = this.pending.get(requestId);
    if (!req || req.channelId !== channelId) return;
    this.pending.delete(requestId);
    this.deps.broadcast({
      type: 'permission_cancelled',
      channelId,
      requestIds: [requestId],
      toolUseIds: req.toolUseId ? [req.toolUseId] : [],
    });
  }

  /** Prompts still waiting for an answer on one channel. */
  pendingFor(channelId: string): PermissionRequest[] {
    return [...this.pending.values()].filter((r) => r.channelId === channelId);
  }

  noteMode(channelId: string, mode: PermissionMode): void {
    const entry = this.modes.get(channelId) ?? { current: undefined, beforePlan: undefined };
    if (mode === 'plan' && entry.current !== 'plan') entry.beforePlan = entry.current;
    entry.current = mode;
    this.modes.set(channelId, entry);
  }

  /** The mode last noted for the channel, or undefined before its launch. */
  modeOf(channelId: string): PermissionMode | undefined {
    return this.modes.get(channelId)?.current;
  }

  /** Records whether the channel's CLI was launched with the dangerous-skip flag. */
  noteBypassAllowed(channelId: string, allowed: boolean): void {
    this.bypassFlags.set(channelId, allowed);
  }

  bypassAllowed(channelId: string): boolean {
    return this.bypassFlags.get(channelId) ?? false;
  }

  private writeDecision(channelId: string, requestId: string, decision: PermissionDecision): boolean {
    return this.deps.write(channelId, {
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response: decision },
    });
  }
}
