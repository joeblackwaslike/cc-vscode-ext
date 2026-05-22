/**
 * Async-iterable FIFO queue with backpressure support.
 *
 * Used as the `fromClientStream` in MessageBroker — enqueues incoming webview messages
 * so the processing loop consumes them serially, preventing race conditions between
 * e.g. launch_claude and a concurrent control_request.
 */
export class AsyncQueue<T> {
  private readonly buffer: T[] = [];
  private readonly resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  /** Enqueue an item. If a consumer is waiting, it is resolved immediately. */
  enqueue(item: T): void {
    if (this.closed) {
      throw new Error('Cannot enqueue into a closed AsyncQueue');
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  /** Signal end-of-stream. Any waiting consumer receives done:true. */
  close(): void {
    this.closed = true;
    for (const resolver of this.resolvers.splice(0)) {
      resolver({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const buffered = this.buffer.shift();
        if (buffered !== undefined) {
          return Promise.resolve({ value: buffered, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}
