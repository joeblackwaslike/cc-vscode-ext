import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AuthCheckResult, IAuthChecker } from './AuthManager';

/**
 * Determines whether the vendored claude CLI is authenticated by reading its
 * credential store — WITHOUT triggering an interactive login. The exact path
 * and format are the one external unknown for this build; isolating them here
 * means a format change is a single-file fix.
 */
export class AuthChecker implements IAuthChecker {
  /** `configDir` overrides resolution (used by tests). */
  constructor(private readonly configDir?: string) {}

  private credentialsPath(): string {
    const dir = this.configDir
      ?? process.env.CLAUDE_CONFIG_DIR
      ?? path.join(os.homedir(), '.claude');
    return path.join(dir, '.credentials.json');
  }

  async checkAuth(): Promise<AuthCheckResult> {
    try {
      const raw = await fsp.readFile(this.credentialsPath(), 'utf8');
      const parsed = JSON.parse(raw) as {
        claudeAiOauth?: { accessToken?: string; expiresAt?: number };
      };
      const oauth = parsed.claudeAiOauth;
      if (!oauth?.accessToken) return { authenticated: false };
      if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) {
        return { authenticated: false };
      }
      return { authenticated: true };
    } catch {
      // Missing file, bad JSON, permission error → treat as logged out.
      return { authenticated: false };
    }
  }
}
