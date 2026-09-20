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
        let title: string;

        try {
          const buf = Buffer.alloc(8192);
          const { bytesRead } = await handle.read(buf, 0, 8192, 0);
          const lines = buf.toString('utf8', 0, bytesRead).split('\n');
          title = formatDateTitle(stat.mtime);
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              if (parsed.type === 'user') {
                const msg = parsed.message as Record<string, unknown> | undefined;
                const content = msg?.content;
                let text = '';
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text') {
                      text = String((block as Record<string, unknown>).text ?? '').trim();
                      break;
                    }
                  }
                }
                if (text) { title = text.slice(0, 80); break; }
              }
            } catch { /* skip malformed lines */ }
          }
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
