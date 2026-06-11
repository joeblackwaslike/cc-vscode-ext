import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AuthCheckResult, IAuthChecker } from './AuthManager';

/**
 * Determines whether the vendored claude CLI is authenticated by reading its
 * config file — WITHOUT triggering an interactive login or a macOS Keychain
 * access prompt.
 *
 * This build keeps the OAuth *token* in the OS keychain, but records the
 * logged-in account in `.claude.json` under `oauthAccount`. Presence of that
 * object is the cheapest reliable "is the user signed in" signal and avoids a
 * keychain prompt. Isolated here so a format change is a single-file fix.
 *
 * Config file location mirrors the CLI: `$CLAUDE_CONFIG_DIR/.claude.json` when
 * the env var is set, otherwise `~/.claude.json`.
 */
export class AuthChecker implements IAuthChecker {
  /** `configDir` overrides resolution (used by tests). */
  constructor(private readonly configDir?: string) {}

  private configPath(): string {
    const dir = this.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? os.homedir();
    return path.join(dir, '.claude.json');
  }

  async checkAuth(): Promise<AuthCheckResult> {
    try {
      const raw = await fsp.readFile(this.configPath(), 'utf8');
      const parsed = JSON.parse(raw) as { oauthAccount?: unknown };
      const account = parsed.oauthAccount;
      const authenticated =
        typeof account === 'object' && account !== null && Object.keys(account).length > 0;
      return { authenticated };
    } catch {
      // Missing file, bad JSON, permission error → treat as logged out.
      return { authenticated: false };
    }
  }
}
