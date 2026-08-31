import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface DiscoveredSession {
  id: string;
  title: string;
  updatedAt: Date;
}

/**
 * Reads Claude CLI session files from ~/.claude/projects/<hash>/ for a given workspace.
 *
 * The hash is the workspace path with every '/' replaced by '-', prefixed with '-'.
 * This matches the directory naming that the Claude CLI itself uses.
 */
export class ClaudeProjectReader {
  getProjectDir(workspacePath: string): string {
    const hash = '-' + workspacePath.replace(/\//g, '-');
    return path.join(os.homedir(), '.claude', 'projects', hash);
  }

  async readSessions(workspacePath: string): Promise<DiscoveredSession[]> {
    const projectDir = this.getProjectDir(workspacePath);

    let files: string[];
    try {
      files = await fs.promises.readdir(projectDir);
    } catch {
      return [];
    }

    const sessions: DiscoveredSession[] = [];

    for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
      const id = file.slice(0, -6);
      const filePath = path.join(projectDir, file);

      try {
        const stat = await fs.promises.stat(filePath);
        const handle = await fs.promises.open(filePath, 'r');
        let title: string;

        try {
          const buf = Buffer.alloc(4096);
          const { bytesRead } = await handle.read(buf, 0, 4096, 0);
          const firstLine = buf.toString('utf8', 0, bytesRead).split('\n')[0] ?? '';
          const parsed = JSON.parse(firstLine || '{}') as { summary?: string };
          title = parsed.summary?.trim() || formatDateTitle(stat.mtime);
        } catch {
          title = formatDateTitle(stat.mtime);
        } finally {
          await handle.close();
        }

        sessions.push({ id, title, updatedAt: stat.mtime });
      } catch {
        // skip unreadable files
      }
    }

    sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return sessions;
  }
}

function formatDateTitle(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `Session ${mm}/${dd} ${hh}:${min}`;
}
