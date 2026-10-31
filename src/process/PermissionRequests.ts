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
}

interface ChannelMode {
  current: PermissionMode | undefined;
  beforePlan: PermissionMode | undefined;
}

export class PermissionRequests {
  private readonly pending = new Map<string, PermissionRequest>();
  private readonly modes = new Map<string, ChannelMode>();

  constructor(private readonly deps: PermissionRequestsDeps) {}

  register(channelId: string, event: CanUseToolEvent): PermissionRequest {
    const { request } = event;
    const req: PermissionRequest = {
      channelId,
      requestId: event.request_id,
      toolName: request.tool_name,
      toolUseId: request.tool_use_id,
      input: request.input ?? {},
      suggestions: request.permission_suggestions,
      description: request.description,
      priorMode: request.tool_name === 'ExitPlanMode' ? this.modes.get(channelId)?.beforePlan : undefined,
    };
    this.pending.set(req.requestId, req);
    this.deps.broadcast({ type: 'permission_request', request: req });
    return req;
  }

  respond(channelId: string, requestId: string, decision: PermissionDecision): boolean {
    const req = this.pending.get(requestId);
    if (!req || req.channelId !== channelId) return false;
    this.pending.delete(requestId);
    if (!this.writeDecision(channelId, requestId, decision)) {
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
    return true;
  }

  denyWithoutPrompt(channelId: string, event: CanUseToolEvent, message: string): void {
    this.writeDecision(channelId, event.request_id, { behavior: 'deny', message });
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

  replayTo(post: (msg: ToWebviewMessage) => void): void {
    for (const request of this.pending.values()) post({ type: 'permission_request', request });
  }

  noteMode(channelId: string, mode: PermissionMode): void {
    const entry = this.modes.get(channelId) ?? { current: undefined, beforePlan: undefined };
    if (mode === 'plan' && entry.current !== 'plan') entry.beforePlan = entry.current;
    entry.current = mode;
    this.modes.set(channelId, entry);
  }

  private writeDecision(channelId: string, requestId: string, decision: PermissionDecision): boolean {
    return this.deps.write(channelId, {
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response: decision },
    });
  }
}
