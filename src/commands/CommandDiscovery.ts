import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CommandEntry {
  name: string;
  namespace?: string;
  description?: string;
}

export class CommandDiscovery {
  async search(query: string): Promise<CommandEntry[]> {
    const results: CommandEntry[] = [];
    const q = query.toLowerCase();

    // ~/.claude/commands/*.md
    const globalDir = path.join(os.homedir(), '.claude', 'commands');
    results.push(...await this.scanDir(globalDir, undefined, q));

    // ~/.claude/plugins/cache/*/commands/*.md
    const pluginCacheDir = path.join(os.homedir(), '.claude', 'plugins', 'cache');
    try {
      const plugins = await fs.promises.readdir(pluginCacheDir);
      for (const plugin of plugins) {
        const cmdDir = path.join(pluginCacheDir, plugin, 'commands');
        results.push(...await this.scanDir(cmdDir, plugin, q));
      }
    } catch { /* no plugins */ }

    return results.sort((a, b) => {
      const aName = a.namespace ? `${a.namespace}:${a.name}` : a.name;
      const bName = b.namespace ? `${b.namespace}:${b.name}` : b.name;
      return aName.localeCompare(bName);
    });
  }

  private async scanDir(dir: string, namespace: string | undefined, q: string): Promise<CommandEntry[]> {
    let files: string[];
    try { files = await fs.promises.readdir(dir); } catch { return []; }
    const entries: CommandEntry[] = [];
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const name = file.slice(0, -3);
      const fullName = namespace ? `${namespace}:${name}` : name;
      if (!q || fullName.toLowerCase().includes(q) || name.toLowerCase().startsWith(q)) {
        entries.push(namespace !== undefined ? { name, namespace } : { name });
      }
    }
    return entries;
  }
}
