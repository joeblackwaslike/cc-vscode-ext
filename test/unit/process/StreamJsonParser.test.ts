import { describe, it, expect, vi } from 'vitest';
import { StreamJsonParser } from '../../../src/process/StreamJsonParser';

describe('StreamJsonParser', () => {
  it('parses a single complete JSON line', () => {
    const events: unknown[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));
    parser.feed('{"type":"message"}\n');
    expect(events).toEqual([{ type: 'message' }]);
  });

  it('parses multiple JSON lines in one chunk', () => {
    const events: unknown[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));
    parser.feed('{"a":1}\n{"b":2}\n{"c":3}\n');
    expect(events).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('handles partial lines split across chunks', () => {
    const events: unknown[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));
    parser.feed('{"type":');
    expect(events).toHaveLength(0);
    parser.feed('"partial"}\n');
    expect(events).toEqual([{ type: 'partial' }]);
  });

  it('skips empty lines', () => {
    const events: unknown[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));
    parser.feed('\n\n{"ok":true}\n\n');
    expect(events).toEqual([{ ok: true }]);
  });

  it('calls onError for malformed JSON and continues', () => {
    const events: unknown[] = [];
    const errors: string[] = [];
    const parser = new StreamJsonParser(
      (e) => events.push(e),
      (line) => errors.push(line)
    );
    parser.feed('bad json\n{"ok":true}\n');
    expect(errors).toEqual(['bad json']);
    expect(events).toEqual([{ ok: true }]);
  });

  it('flushes incomplete buffer on flush()', () => {
    const events: unknown[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));
    parser.feed('{"flushed":true}');
    expect(events).toHaveLength(0);
    parser.flush();
    expect(events).toEqual([{ flushed: true }]);
  });

  it('flush() does nothing on empty buffer', () => {
    const onEvent = vi.fn();
    const parser = new StreamJsonParser(onEvent);
    parser.flush();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('handles multiple feeds followed by flush of a malformed tail', () => {
    const events: unknown[] = [];
    const errors: string[] = [];
    const parser = new StreamJsonParser(
      (e) => events.push(e),
      (line) => errors.push(line)
    );
    parser.feed('{"a":1}\n{"b":');
    parser.feed('2}\n{"c":');
    parser.flush();
    // {"a":1} and {"b":2} are complete; {"c": is a malformed partial — goes to onError
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
    expect(errors).toEqual(['{"c":']);
  });
});
