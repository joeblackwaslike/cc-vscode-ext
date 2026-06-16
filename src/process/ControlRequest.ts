/**
 * Correlates `control_request` / `control_response` over the CLI's stream-json
 * stdin/stdout. The CLI accepts lines like
 *   {type:'control_request', request_id, request:{subtype, ...}}
 * and replies (interleaved with normal events) with
 *   {type:'control_response', response:{subtype:'success'|'error', request_id, response?, error?}}
 *
 * This manager writes the request, resolves the matching promise by request_id,
 * and times out stragglers so the map can't leak. No `initialize` handshake is
 * required (verified against claude 2.1.x).
 */

export type ControlSubtype =
  | 'set_permission_mode'
  | 'set_model'
  | 'set_max_thinking_tokens'
  | 'get_context_usage'
  | 'interrupt';

interface Pending {
  resolve: (response: Record<string, unknown> | undefined) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ControlResponseEvent {
  type: 'control_response';
  response?: {
    subtype?: string;
    request_id?: string;
    response?: Record<string, unknown>;
    error?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class ControlRequestManager {
  private readonly pending = new Map<string, Pending>();
  private counter = 0;

  constructor(
    private readonly write: (channelId: string, data: unknown) => void,
    private readonly newId: () => string = () => `cc_ctrl_${Date.now()}_${++this.counter}`,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Send a control request and resolve with its `response` payload (or undefined
   * for ack-only subtypes). Rejects on an `error` response or on timeout.
   */
  send(
    channelId: string,
    subtype: ControlSubtype,
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown> | undefined> {
    const requestId = this.newId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`control_request '${subtype}' timed out`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.write(channelId, {
        type: 'control_request',
        request_id: requestId,
        request: { subtype, ...payload },
      });
    });
  }

  /**
   * Settle the pending request matching a `control_response`. Returns true if it
   * was one of ours (caller should then NOT broadcast it as a stream event).
   */
  handleResponse(event: ControlResponseEvent): boolean {
    const response = event.response;
    const requestId = response?.request_id;
    if (typeof requestId !== 'string') return false;
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    if (response?.subtype === 'error') {
      entry.reject(new Error(response.error ?? 'control_request failed'));
    } else {
      entry.resolve(response?.response);
    }
    return true;
  }

  /** Reject all in-flight requests (e.g. when a channel closes). */
  dispose(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('control channel disposed'));
    }
    this.pending.clear();
  }
}
