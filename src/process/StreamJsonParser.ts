/**
 * NDJSON (newline-delimited JSON) stream parser.
 *
 * Buffers incomplete lines across chunk boundaries and emits one parsed object
 * per complete newline-terminated line. Malformed JSON lines are silently skipped
 * (the claude CLI guarantees well-formed output; bad lines are stray stderr leakage).
 */
export class StreamJsonParser {
  private buffer = '';

  private readonly onEvent: (event: unknown) => void;
  private readonly onError: ((line: string, err: unknown) => void) | undefined;

  constructor(onEvent: (event: unknown) => void, onError?: (line: string, err: unknown) => void) {
    this.onEvent = onEvent;
    this.onError = onError;
  }

  /**
   * Feed a raw chunk from stdout. May contain zero, one, or multiple JSON lines.
   * Partial lines are buffered until the next chunk completes them.
   */
  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // Last element is the incomplete tail — keep it in the buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        this.onEvent(JSON.parse(trimmed));
      } catch (err) {
        this.onError?.(trimmed, err);
      }
    }
  }

  /**
   * Flush any remaining buffered content (e.g. on process close).
   * A trailing line without a newline is parsed if non-empty.
   */
  flush(): void {
    const trimmed = this.buffer.trim();
    this.buffer = '';
    if (trimmed.length === 0) return;
    try {
      this.onEvent(JSON.parse(trimmed));
    } catch (err) {
      this.onError?.(trimmed, err);
    }
  }
}
