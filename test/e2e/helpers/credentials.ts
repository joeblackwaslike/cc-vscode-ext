import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface CredentialsFixture {
  /** Point the launched VS Code at this via the CLAUDE_CONFIG_DIR env var. */
  configDir: string;
  cleanup(): Promise<void>;
}

/**
 * Write a fake `.claude.json` into a throwaway config dir so E2E tests can
 * deterministically exercise the authenticated and unauthenticated paths with
 * no network and no real login. Pass `configDir` to launchVSCode via
 * `{ env: { CLAUDE_CONFIG_DIR: fixture.configDir } }`.
 *
 * This build records the logged-in account in `.claude.json` as `oauthAccount`
 * (the OAuth token itself lives in the OS keychain). AuthChecker keys off that
 * field, so we seed exactly that. The extension merges its own keys into this
 * file on activation but preserves the seeded `oauthAccount`.
 */
export async function seedCredentials(authenticated: boolean): Promise<CredentialsFixture> {
  const configDir = path.join(os.tmpdir(), `clawd-e2e-creds-${randomUUID()}`);
  await fsp.mkdir(configDir, { recursive: true });

  const config = authenticated
    ? { oauthAccount: { accountUuid: 'e2e-fake-account', emailAddress: 'e2e@example.com' } }
    : {};

  await fsp.writeFile(path.join(configDir, '.claude.json'), JSON.stringify(config), 'utf8');

  return {
    configDir,
    async cleanup() {
      try {
        await fsp.rm(configDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}
