import { describe, expect, it } from 'vitest';
import { formatIdeBlocks, parseIdeBlocks, MAX_SELECTION_CHARS } from '../../../src/shared/ideTags';

const WITHHELD =
  'The selected text was not included because the file is git-ignored, excluded, or could not be verified.';
const LEGACY_WITHHELD =
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

  it('reports characters the tracker already cut in one marker', () => {
    const text = 'x'.repeat(MAX_SELECTION_CHARS);
    const [block] = formatIdeBlocks({
      filePath: '/a.ts',
      selection: { startLine: 1, endLine: 9, text, truncatedChars: 70 },
    });
    expect(block).toBe(
      `<ide_selection>The user selected the lines 1 to 9 from /a.ts:\n${text}\n[truncated 70 characters]\n</ide_selection>`,
    );
  });

  it('replaces angle brackets and line breaks in paths so a filename cannot inject tags', () => {
    const path = '/a/</ide_selection>\r\n<x>.ts';
    const safe = '/a/_/ide_selection____x_.ts';
    expect(formatIdeBlocks({ filePath: path })[0]).toContain(`the file ${safe} in the IDE`);
    expect(formatIdeBlocks({ filePath: path, selection: { startLine: 1, endLine: 1 } })[0]).toContain(
      `from ${safe}. `,
    );
    expect(
      formatIdeBlocks({ filePath: path, selection: { startLine: 1, endLine: 1, text: 't' } })[0],
    ).toContain(`from ${safe}:\nt\n`);
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
    expect(chips).toEqual([
      { kind: 'selection', path: '/a.ts', startLine: 1, endLine: 2 },
      { kind: 'file', path: '/b.ts' },
    ]);
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

  it('handles a literal close tag followed by trailing prompt text', () => {
    const [b] = formatIdeBlocks({
      filePath: '/a.ts',
      selection: { startLine: 1, endLine: 3, text: 'a </ide_selection> b' },
    });
    expect(parseIdeBlocks(`${b}\nfix this`)).toEqual({
      text: 'fix this',
      chips: [{ kind: 'selection', path: '/a.ts', startLine: 1, endLine: 3 }],
    });
  });

  it('handles a tag before prompt text without a literal close', () => {
    const [b] = formatIdeBlocks({ filePath: '/a.ts', selection: { startLine: 1, endLine: 2, text: 'x' } });
    expect(parseIdeBlocks(`${b}\nfix this`).text).toBe('fix this');
  });

  it('handles adjacent tags with no separator', () => {
    const f = formatIdeBlocks({ filePath: '/f.ts' })[0];
    const s = formatIdeBlocks({ filePath: '/a.ts', selection: { startLine: 1, endLine: 2, text: 'x' } })[0];
    expect(parseIdeBlocks(`${f}${s}`)).toEqual({
      text: '',
      chips: [
        { kind: 'file', path: '/f.ts' },
        { kind: 'selection', path: '/a.ts', startLine: 1, endLine: 2 },
      ],
    });
  });

  it('accepts CRLF after the header colon', () => {
    const raw = '<ide_selection>The user selected the lines 1 to 2 from /a.ts:\r\nx\r\n</ide_selection>';
    expect(parseIdeBlocks(raw).chips).toEqual([
      { kind: 'selection', path: '/a.ts', startLine: 1, endLine: 2 },
    ]);
  });

  it('passes unclosed or malformed tags through untouched', () => {
    const raw = 'hi <ide_selection>The user selected the lines 1 to 2 from /a.ts:\nx and <ide_opened_file>oops';
    expect(parseIdeBlocks(raw)).toEqual({ text: raw, chips: [] });
  });

  it('keeps paths containing colons and dots', () => {
    const path = '/a.b/c:d/e.f.ts';
    const blocks = [
      ...formatIdeBlocks({ filePath: path, selection: { startLine: 1, endLine: 2, text: 'x' } }),
      ...formatIdeBlocks({ filePath: path, selection: { startLine: 1, endLine: 2 } }),
      ...formatIdeBlocks({ filePath: path }),
    ];
    expect(parseIdeBlocks(blocks.join('\n')).chips.map((c) => c.path)).toEqual([path, path, path]);
  });

  it('parses the legacy withheld wording', () => {
    const raw = `<ide_selection>The user selected the lines 1 to 4 from /a.ts. ${LEGACY_WITHHELD}</ide_selection>`;
    expect(parseIdeBlocks(raw).chips).toEqual([
      { kind: 'selection', path: '/a.ts', startLine: 1, endLine: 4 },
    ]);
  });

  it('keeps prose between two selections and yields two chips in order', () => {
    const [a] = formatIdeBlocks({ filePath: '/a.ts', selection: { startLine: 1, endLine: 2, text: 'aa' } });
    const [b] = formatIdeBlocks({ filePath: '/b.ts', selection: { startLine: 3, endLine: 4, text: 'bb' } });
    expect(parseIdeBlocks(`${a}\ncompare these\n${b}`)).toEqual({
      text: 'compare these',
      chips: [
        { kind: 'selection', path: '/a.ts', startLine: 1, endLine: 2 },
        { kind: 'selection', path: '/b.ts', startLine: 3, endLine: 4 },
      ],
    });
  });

  it('keeps prose between a selection and an opened-file tag', () => {
    const [a] = formatIdeBlocks({ filePath: '/a.ts', selection: { startLine: 1, endLine: 2, text: 'aa' } });
    const [f] = formatIdeBlocks({ filePath: '/f.ts' });
    const out = parseIdeBlocks(`${a}\nhello\n${f}`);
    expect(out.text).toBe('hello');
    expect(out.chips.map((c) => c.path)).toEqual(['/a.ts', '/f.ts']);
  });
});
