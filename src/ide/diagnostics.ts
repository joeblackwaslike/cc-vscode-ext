import * as vscode from 'vscode';
import type { CollectDiagnostics, ToolTextBlock } from './DiagnosticsMcpServer';

export const MAX_DIAGNOSTIC_FILES = 200;
export const MAX_DIAGNOSTICS_PER_FILE = 100;

const WITHHELD_EXPLICIT_NOTE = 'Diagnostics withheld: the file is git-ignored, excluded, or could not be verified.';

interface DiagnosticsCollectorDeps {
  isWithheld: (uri: vscode.Uri) => Promise<boolean>;
}

interface DiagnosticsEntry {
  uri: string;
  linesInFile?: number;
  diagnostics: unknown[];
}

const text = (value: string): ToolTextBlock => ({ type: 'text', text: value });

function codeValue(code: vscode.Diagnostic['code']): string | number | undefined {
  return typeof code === 'object' ? code.value : code;
}

function toEntry(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): DiagnosticsEntry {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  return {
    uri: uri.toString(),
    ...(doc ? { linesInFile: doc.lineCount } : {}),
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE).map((d) => ({
      message: d.message,
      severity: vscode.DiagnosticSeverity[d.severity],
      range: {
        start: { line: d.range.start.line, character: d.range.start.character },
        end: { line: d.range.end.line, character: d.range.end.character },
      },
      source: d.source,
      code: codeValue(d.code),
    })),
  };
}

function parseFileUri(raw: string): vscode.Uri | undefined {
  try {
    const uri = vscode.Uri.parse(raw);
    return uri.scheme === 'file' ? uri : undefined;
  } catch {
    return undefined;
  }
}

/** Withheld when the check says so or fails to answer, so an unsettled check fails closed. */
async function isWithheldSafe(deps: DiagnosticsCollectorDeps, uri: vscode.Uri): Promise<boolean> {
  try {
    return await deps.isWithheld(uri);
  } catch {
    return true;
  }
}

/**
 * Reads the Problems panel for the `getDiagnostics` tool. Files the ignore
 * check withholds are dropped, and the all-files form is capped.
 */
export function createDiagnosticsCollector(deps: DiagnosticsCollectorDeps): CollectDiagnostics {
  return async (rawUri) => {
    if (rawUri !== undefined) {
      const uri = parseFileUri(rawUri);
      if (!uri) return [text('[]')];
      if (await isWithheldSafe(deps, uri)) return [text('[]'), text(WITHHELD_EXPLICIT_NOTE)];
      const found = vscode.languages.getDiagnostics(uri);
      const entries = found.length > 0 ? [toEntry(uri, found)] : [];
      return [text(JSON.stringify(entries, null, 2))];
    }

    const candidates = vscode.languages
      .getDiagnostics()
      .filter(([uri, found]) => uri.scheme === 'file' && found.length > 0);
    const verdicts = await Promise.all(candidates.map(([uri]) => isWithheldSafe(deps, uri)));
    const visible = candidates.filter((_, i) => !verdicts[i]);
    const withheld = candidates.length - visible.length;
    const shown = visible.slice(0, MAX_DIAGNOSTIC_FILES);
    const cutFiles = visible.length - shown.length;
    const cutDiagnostics = shown.reduce((n, [, found]) => n + Math.max(0, found.length - MAX_DIAGNOSTICS_PER_FILE), 0);

    const notes: string[] = [];
    if (withheld > 0) {
      notes.push(`Diagnostics withheld for ${withheld} file(s) that are git-ignored, excluded, or could not be verified.`);
    }
    if (cutFiles > 0 || cutDiagnostics > 0) {
      notes.push(
        `Output truncated: ${cutFiles} files and ${cutDiagnostics} diagnostics were cut ` +
          `(limits: ${MAX_DIAGNOSTIC_FILES} files, ${MAX_DIAGNOSTICS_PER_FILE} diagnostics per file).`
      );
    }
    const entries = shown.map(([uri, found]) => toEntry(uri, found));
    return [text(JSON.stringify(entries, null, 2)), ...(notes.length ? [text(notes.join(' '))] : [])];
  };
}
