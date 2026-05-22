/**
 * Routes parsed stream-json events from the claude CLI to the correct channel handler.
 *
 * Each active conversation has a `channelId` (UUID assigned at launch). When the subprocess
 * emits an event, `route()` looks up the registered handler for that channelId and calls it.
 * Events for unknown channels are dropped (can occur after a channel is closed).
 */
export class ChannelRouter {
  private readonly handlers = new Map<string, (event: unknown) => void>();

  /** Register a handler for events arriving on the given channelId. */
  register(channelId: string, handler: (event: unknown) => void): void {
    this.handlers.set(channelId, handler);
  }

  /** Remove the handler for a channel (called when the subprocess for that channel closes). */
  unregister(channelId: string): void {
    this.handlers.delete(channelId);
  }

  /**
   * Dispatch a parsed event to its channel handler.
   * Events whose channelId has no registered handler are silently dropped.
   */
  route(channelId: string, event: unknown): void {
    this.handlers.get(channelId)?.(event);
  }

  /** Returns true if a handler is registered for the given channelId. */
  has(channelId: string): boolean {
    return this.handlers.has(channelId);
  }
}
