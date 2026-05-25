/**
 * A raw event emitted by the claude CLI on stdout (stream-json format).
 * The full union is defined by Anthropic's stream protocol; we treat it as
 * an opaque object here and relay it to the webview unchanged.
 */
export type ClaudeStreamEvent = Record<string, unknown> & { type: string };
