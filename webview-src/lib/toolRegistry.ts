/**
 * Per-tool rendering: how to summarize a tool call as a compact header
 * (`Read` (utils.py)) and how to present its result inline. A registry keyed by
 * tool name with a sensible default — add tools by adding entries, not by
 * touching the components.
 */
import { isRecord } from './blocks';

export type ResultMode = 'lines' | 'diff' | 'text';

export interface RenderedResult {
  mode: ResultMode;
  /** Pre-formatted text to display (line-numbered, diff, or raw output). */
  content: string;
}

export interface ToolRenderer {
  /** Short parenthetical shown after the tool name, e.g. a file basename. */
  primaryArg(input: Record<string, unknown>): string;
  /** Turn the paired result text (+ the call input) into displayable content. */
  renderResult(resultText: string, input: Record<string, unknown>): RenderedResult;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === 'string' ? v : '';
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

/** Build a minimal -old / +new diff from an edit's strings. */
function diffFromEdit(oldStr: string, newStr: string): string {
  const del = oldStr ? oldStr.split('\n').map((l) => `- ${l}`).join('\n') : '';
  const add = newStr ? newStr.split('\n').map((l) => `+ ${l}`).join('\n') : '';
  return [del, add].filter(Boolean).join('\n');
}

const asText = (content: string): RenderedResult => ({ mode: 'text', content });

// ── registry ───────────────────────────────────────────────────────────────

const fileTool: ToolRenderer = {
  primaryArg: (input) => basename(str(input, 'file_path')),
  renderResult: (resultText) => ({ mode: 'lines', content: resultText }),
};

const editTool: ToolRenderer = {
  primaryArg: (input) => basename(str(input, 'file_path')),
  renderResult: (_resultText, input) => ({
    mode: 'diff',
    content: diffFromEdit(str(input, 'old_string'), str(input, 'new_string')),
  }),
};

const toolRegistry: Record<string, ToolRenderer> = {
  Read: fileTool,
  Edit: editTool,
  MultiEdit: {
    primaryArg: (input) => basename(str(input, 'file_path')),
    renderResult: (_resultText, input) => {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      const content = edits
        .filter(isRecord)
        .map((e) => diffFromEdit(String(e.old_string ?? ''), String(e.new_string ?? '')))
        .join('\n');
      return { mode: 'diff', content };
    },
  },
  Write: {
    primaryArg: (input) => basename(str(input, 'file_path')),
    renderResult: (_resultText, input) => asText(str(input, 'content')),
  },
  Bash: {
    primaryArg: (input) => truncate(str(input, 'command'), 60),
    renderResult: (resultText) => asText(resultText),
  },
  Grep: {
    primaryArg: (input) => str(input, 'pattern'),
    renderResult: (resultText) => asText(resultText),
  },
  Glob: {
    primaryArg: (input) => str(input, 'pattern'),
    renderResult: (resultText) => asText(resultText),
  },
  Task: {
    primaryArg: (input) => truncate(str(input, 'description'), 60),
    renderResult: (resultText) => asText(resultText),
  },
  WebFetch: {
    primaryArg: (input) => str(input, 'url'),
    renderResult: (resultText) => asText(resultText),
  },
  WebSearch: {
    primaryArg: (input) => str(input, 'query'),
    renderResult: (resultText) => asText(resultText),
  },
};

const defaultRenderer: ToolRenderer = {
  primaryArg: (input) => {
    const firstString = Object.values(input).find((v) => typeof v === 'string');
    return typeof firstString === 'string' ? truncate(firstString, 50) : '';
  },
  renderResult: (resultText) => asText(resultText),
};

export function getToolRenderer(name: string): ToolRenderer {
  return toolRegistry[name] ?? defaultRenderer;
}
