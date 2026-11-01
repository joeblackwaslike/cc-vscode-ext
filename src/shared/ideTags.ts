export interface IdeSelection {
  startLine: number;
  endLine: number;
  text?: string;
}

export interface IdeContext {
  filePath: string;
  selection?: IdeSelection;
}

export interface IdeChip {
  kind: 'file' | 'selection';
  path: string;
  startLine?: number;
  endLine?: number;
}

export const MAX_SELECTION_CHARS = 50_000;

const FILE_OPEN = '<ide_opened_file>The user opened the file ';
const FILE_SUFFIX = ' in the IDE. This may or may not be related to the current task.';
const FILE_CLOSE = '</ide_opened_file>';
const SEL_CLOSE = '</ide_selection>';
const WITHHELD =
  'The selected text was not included because the file is git-ignored or excluded.';

const SEL_HEAD = /<ide_selection>The user selected the lines (\d+) to (\d+) from /y;
const NEXT_TAG = /\s*<ide_(?:selection|opened_file)>/y;

function formatSelection(path: string, sel: NonNullable<IdeContext['selection']>): string {
  const head = `<ide_selection>The user selected the lines ${sel.startLine} to ${sel.endLine} from ${path}`;
  if (sel.text === undefined) return `${head}. ${WITHHELD}${SEL_CLOSE}`;
  const over = sel.text.length - MAX_SELECTION_CHARS;
  const body =
    over > 0
      ? `${sel.text.slice(0, MAX_SELECTION_CHARS)}\n[truncated ${over} characters]`
      : sel.text;
  return `${head}:\n${body}\n${SEL_CLOSE}`;
}

/** Builds the tag blocks that carry the editor context to the model. */
export function formatIdeBlocks(ctx: IdeContext): string[] {
  if (ctx.selection) return [formatSelection(ctx.filePath, ctx.selection)];
  return [`${FILE_OPEN}${ctx.filePath}${FILE_SUFFIX}${FILE_CLOSE}`];
}

function closeIndex(text: string, from: number): number {
  let last = -1;
  for (let i = text.indexOf(SEL_CLOSE, from); i !== -1; i = text.indexOf(SEL_CLOSE, i + 1)) {
    last = i;
    const after = i + SEL_CLOSE.length;
    NEXT_TAG.lastIndex = after;
    if (after === text.length || NEXT_TAG.test(text)) return i;
  }
  return last;
}

function selectionPath(inner: string): string | undefined {
  if (inner.endsWith(`. ${WITHHELD}`)) return inner.slice(0, -(WITHHELD.length + 2));
  const colon = inner.search(/:\r?\n/);
  return colon === -1 ? undefined : inner.slice(0, colon);
}

function matchAt(text: string, at: number): { chip: IdeChip; end: number } | undefined {
  SEL_HEAD.lastIndex = at;
  const sel = SEL_HEAD.exec(text);
  if (sel) {
    const bodyStart = at + sel[0].length;
    const close = closeIndex(text, bodyStart);
    if (close === -1) return undefined;
    const path = selectionPath(text.slice(bodyStart, close));
    if (path === undefined) return undefined;
    const chip: IdeChip = { kind: 'selection', path, startLine: Number(sel[1]), endLine: Number(sel[2]) };
    return { chip, end: close + SEL_CLOSE.length };
  }
  if (!text.startsWith(FILE_OPEN, at)) return undefined;
  const bodyStart = at + FILE_OPEN.length;
  const close = text.indexOf(FILE_CLOSE, bodyStart);
  if (close === -1) return undefined;
  const inner = text.slice(bodyStart, close);
  if (!inner.endsWith(FILE_SUFFIX)) return undefined;
  const path = inner.slice(0, -FILE_SUFFIX.length);
  return { chip: { kind: 'file', path }, end: close + FILE_CLOSE.length };
}

/** Strips recognized ide tags from `text` and returns them as chips, in order. */
export function parseIdeBlocks(text: string): { text: string; chips: IdeChip[] } {
  const chips: IdeChip[] = [];
  let rest = '';
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<ide_', i);
    if (lt === -1) break;
    const m = matchAt(text, lt);
    if (!m) {
      rest += text.slice(i, lt + 1);
      i = lt + 1;
      continue;
    }
    rest += text.slice(i, lt);
    chips.push(m.chip);
    i = m.end;
    if (/\s$/.test(rest)) while (i < text.length && /\s/.test(text[i]!)) i++;
  }
  rest += text.slice(i);
  return { text: rest.trim(), chips };
}
