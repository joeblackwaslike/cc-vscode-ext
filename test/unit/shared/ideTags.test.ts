import { describe, expect, it } from 'vitest';
import { formatIdeBlocks, parseIdeBlocks, MAX_SELECTION_CHARS } from '../../../src/shared/ideTags';

const WITHHELD =
  'The selected text was not included because the file is git-ignored or excluded.';

describe('formatIdeBlocks', () => {
  it('formats the file form', () => {
    expect(formatIdeBlocks({ filePath: '/a/b.ts' })).toEqual([
      '<ide_opened_file>The user opened the file /a/b.ts in the IDE. This may or may not be related to the current task.</ide_opened_file>',
    ]);
  });

  it('formats the selection form and passes odd paths through', () => {
    const path = '/a b/$x/`y`.ts';
    expect(
      formatIdeBlocks({ filePath: path, selection: { startLine: 2, endLine: 3, text: 'one\ntwo' } }),
    ).toEqual([`<ide_selection>The user selected the lines 2 to 3 from ${path}:\none\ntwo\n</ide_selection>`]);
  });

  it('formats the withheld form', () => {
    expect(formatIdeBlocks({ filePath: '/a.ts', selection: { startLine: 1, endLine: 4 } })).toEqual([
      `<ide_selection>The user selected the lines 1 to 4 from /a.ts. ${WITHHELD}</ide_selection>`,
    ]);
  });

  it('truncates text over the cap', () => {
    const text = 'x'.repeat(MAX_SELECTION_CHARS + 1);
    const [block] = formatIdeBlocks({ filePath: '/a.ts', selection: { startLine: 1, endLine: 1, text } });
    expect(block).toBe(
      `<ide_selection>The user selected the lines 1 to 1 from /a.ts:\n${'x'.repeat(MAX_SELECTION_CHARS)}\n[truncated 1 characters]\n</ide_selection>`,
    );
  });
});

describe('parseIdeBlocks', () => {
  it('returns plain text unchanged', () => {
    expect(parseIdeBlocks('hello')).toEqual({ text: 'hello', chips: [] });
  });

  it('round-trips the file form', () => {
    const [b] = formatIdeBlocks({ filePath: '/a b.ts' });
    expect(parseIdeBlocks(`do it\n${b}`)).toEqual({
      text: 'do it',
      chips: [{ kind: 'file', path: '/a b.ts' }],
    });
  });

  it('round-trips the selection form', () => {
    const [b] = formatIdeBlocks({
      filePath: '/a/$b.ts',
      selection: { startLine: 5, endLine: 9, text: 'l1\nl2' },
    });
    expect(parseIdeBlocks(`prompt${b}`)).toEqual({
      text: 'prompt',
      chips: [{ kind: 'selection', path: '/a/$b.ts', startLine: 5, endLine: 9 }],
    });
  });

  it('round-trips the withheld form', () => {
    const [b] = formatIdeBlocks({ filePath: '/a.ts', selection: { startLine: 1, endLine: 4 } });
    expect(parseIdeBlocks(b)).toEqual({
      text: '',
      chips: [{ kind: 'selection', path: '/a.ts', startLine: 1, endLine: 4 }],
    });
  });

  it('parses several blocks in order', () => {
    const blocks = [
      ...formatIdeBlocks({ filePath: '/a.ts', selection: { startLine: 1, endLine: 2, text: 't' } }),
      ...formatIdeBlocks({ filePath: '/b.ts' }),
    ];
    const { text, chips } = parseIdeBlocks(`hi\n${blocks.join('\n')}`);
    expect(text).toBe('hi');
    expect(chips.map((c) => c.kind)).toEqual(['selection', 'file']);
  });

  it('keeps a literal closing tag inside selection text as one chip', () => {
    const [b] = formatIdeBlocks({
      filePath: '/a.ts',
      selection: { startLine: 1, endLine: 3, text: 'a </ide_selection> b' },
    });
    const file = formatIdeBlocks({ filePath: '/a.ts' })[0];
    expect(parseIdeBlocks(`p\n${b}`)).toEqual({
      text: 'p',
      chips: [{ kind: 'selection', path: '/a.ts', startLine: 1, endLine: 3 }],
    });
    expect(parseIdeBlocks(`p\n${b}\n${file}`).chips).toHaveLength(2);
  });
});
