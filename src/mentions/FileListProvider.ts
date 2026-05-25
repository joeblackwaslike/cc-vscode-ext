import * as vscode from 'vscode';
import { relative, sep } from 'path';

/**
 * Provides a filtered list of workspace files for the @ mention dropdown.
 *
 * Scans the workspace with `workspace.findFiles` and returns relative paths
 * that fuzzy-match the query string. Results are capped at 100 entries.
 */
export class FileListProvider {
  private static readonly MAX_RESULTS = 100;
  private static readonly EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**,**/dist/**,**/.vscode/**}';

  async listFiles(query: string, cwd?: string): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return [];

    const folder = cwd
      ? workspaceFolders.find((f) => f.uri.fsPath === cwd) ?? workspaceFolders[0]!
      : workspaceFolders[0]!;

    const pattern = new vscode.RelativePattern(folder, '**/*');
    const uris = await vscode.workspace.findFiles(
      pattern,
      FileListProvider.EXCLUDE_GLOB,
      FileListProvider.MAX_RESULTS,
    );

    const relativePaths = uris.map((uri) =>
      relative(folder.uri.fsPath, uri.fsPath).split(sep).join('/'),
    );

    if (!query) return relativePaths;

    const lower = query.toLowerCase();
    return relativePaths.filter((p) => p.toLowerCase().includes(lower));
  }
}
