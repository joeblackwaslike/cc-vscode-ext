import * as vscode from 'vscode';
import type { CollectDiagnostics, ToolTextBlock } from './DiagnosticsMcpServer';

export const MAX_DIAGNOSTIC_FILES = 200;
export const MAX_DIAGNOSTICS_PER_FILE = 100;
export const MAX_PROBED_FILES = 1000;
export const COLLECTOR_DEADLINE_MS = 20_000;
const PROBE_CONCURRENCY = 8;

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
    const shown: Array<[vscode.Uri, readonly vscode.Diagnostic[]]> = [];
    let probed = 0;
    let withheld = 0;
    const deadline = Date.now() + COLLECTOR_DEADLINE_MS;
    while (
      shown.length < MAX_DIAGNOSTIC_FILES &&
      probed < Math.min(candidates.length, MAX_PROBED_FILES) &&
      Date.now() < deadline
    ) {
      const size = Math.min(PROBE_CONCURRENCY, MAX_DIAGNOSTIC_FILES - shown.length, MAX_PROBED_FILES - probed);
      const chunk = candidates.slice(probed, probed + size);
      const verdicts = await Promise.all(chunk.map(([uri]) => isWithheldSafe(deps, uri)));
      probed += chunk.length;
      chunk.forEach((candidate, i) => (verdicts[i] ? withheld++ : shown.push(candidate)));
    }
    const notExamined = candidates.length - probed;
    const cutDiagnostics = shown.reduce((n, [, found]) => n + Math.max(0, found.length - MAX_DIAGNOSTICS_PER_FILE), 0);

    const notes: string[] = [];
    if (withheld > 0) {
      notes.push(`Diagnostics withheld for ${withheld} file(s) that are git-ignored, excluded, or could not be verified.`);
    }
    if (notExamined > 0) {
      notes.push(
        `${notExamined} files not examined after the ${MAX_DIAGNOSTIC_FILES}-file limit, the ${MAX_PROBED_FILES}-file probe limit or the ${COLLECTOR_DEADLINE_MS / 1000}s time limit, ${withheld} of the examined files withheld.`
      );
    }
    if (cutDiagnostics > 0) {
      notes.push(`${cutDiagnostics} diagnostics were cut (limit ${MAX_DIAGNOSTICS_PER_FILE} per file).`);
    }
    const entries = shown.map(([uri, found]) => toEntry(uri, found));
    return [text(JSON.stringify(entries, null, 2)), ...(notes.length ? [text(notes.join(' '))] : [])];
  };
}
