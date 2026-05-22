import { describe, it, expect } from 'vitest';
import { AsyncQueue } from '../../../src/ipc/AsyncQueue';

async function collectAll<T>(queue: AsyncQueue<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of queue) {
    results.push(item);
  }
  return results;
}

describe('AsyncQueue', () => {
  it('yields items in FIFO order', async () => {
    const queue = new AsyncQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    queue.close();
    expect(await collectAll(queue)).toEqual([1, 2, 3]);
  });

  it('resolves a waiting consumer when an item is enqueued', async () => {
    const queue = new AsyncQueue<string>();
    const iterResult = queue[Symbol.asyncIterator]().next();
    queue.enqueue('hello');
    expect(await iterResult).toEqual({ value: 'hello', done: false });
  });

  it('terminates iteration after close()', async () => {
    const queue = new AsyncQueue<number>();
    queue.enqueue(42);
    queue.close();
    const iter = queue[Symbol.asyncIterator]();
    expect(await iter.next()).toEqual({ value: 42, done: false });
    const second = await iter.next();
    expect(second.done).toBe(true);
  });

  it('resolves waiting consumers with done:true when closed', async () => {
    const queue = new AsyncQueue<number>();
    const pending = queue[Symbol.asyncIterator]().next();
    queue.close();
    const result = await pending;
    expect(result.done).toBe(true);
  });

  it('throws when enqueuing into a closed queue', () => {
    const queue = new AsyncQueue<number>();
    queue.close();
    expect(() => queue.enqueue(1)).toThrow('closed');
  });

  it('handles concurrent producer and consumer', async () => {
    const queue = new AsyncQueue<number>();
    const collected: number[] = [];

    const consumer = (async () => {
      for await (const item of queue) {
        collected.push(item);
      }
    })();

    for (let i = 0; i < 5; i++) {
      queue.enqueue(i);
    }
    queue.close();

    await consumer;
    expect(collected).toEqual([0, 1, 2, 3, 4]);
  });
});
