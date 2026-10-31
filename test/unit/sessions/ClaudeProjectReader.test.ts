import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeProjectReader } from '../../../src/sessions/ClaudeProjectReader';

describe('ClaudeProjectReader.readSessionEvents', () => {
  let dir: string;
  const reader = new ClaudeProjectReader();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr-'));
    vi.spyOn(reader, 'getProjectDir').mockReturnValue(dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when the session file does not exist', async () => {
    await expect(reader.readSessionEvents('missing', '/ws')).resolves.toEqual([]);
  });

  it('rethrows read errors other than ENOENT so the caller can log them', async () => {
    fs.mkdirSync(path.join(dir, 'a-dir.jsonl'));
    await expect(reader.readSessionEvents('a-dir', '/ws')).rejects.toThrow();
  });

  it('skips malformed lines and filters recall-record and ai-title events', async () => {
    const lines = [
      JSON.stringify({ type: 'user', n: 1 }),
      'not json',
      '',
      JSON.stringify({ type: 'recall-record' }),
      JSON.stringify({ type: 'ai-title' }),
      JSON.stringify({ type: 'assistant', n: 2 }),
    ];
    fs.writeFileSync(path.join(dir, 's1.jsonl'), lines.join('\n'));

    await expect(reader.readSessionEvents('s1', '/ws')).resolves.toEqual([
      { type: 'user', n: 1 },
      { type: 'assistant', n: 2 },
    ]);
  });
});
