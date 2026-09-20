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
 * The hash is the workspace path with every '/' replaced by '-'.
 * This matches the directory naming that the Claude CLI itself uses.
 */
export class ClaudeProjectReader {
  getProjectDir(workspacePath: string): string {
    // Claude CLI hashes paths by replacing every '/' with '-'.
    // The leading '/' already becomes the leading '-', so no extra prefix needed.
    const hash = workspacePath.replace(/\//g, '-');
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
        let title = formatDateTitle(stat.mtime);

        try {
          // recall-record (AI-generated title) is appended at session end — read tail.
          const tailSize = Math.min(stat.size, 8192);
          const tailBuf = Buffer.alloc(tailSize);
          await handle.read(tailBuf, 0, tailSize, stat.size - tailSize);
          const lines = tailBuf.toString('utf8').split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line) continue;
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              if (parsed.type === 'recall-record' && typeof parsed.title === 'string' && parsed.title.trim()) {
                title = parsed.title.trim();
                break;
              }
            } catch { /* skip malformed */ }
          }
        } catch {
          // keep date fallback
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
