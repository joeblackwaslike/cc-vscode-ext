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
 * Write a fake `.credentials.json` into a throwaway config dir so E2E tests can
 * deterministically exercise the authenticated and unauthenticated paths with
 * no network and no real login. Pass `configDir` to launchVSCode via
 * `{ env: { CLAUDE_CONFIG_DIR: fixture.configDir } }`.
 */
export async function seedCredentials(authenticated: boolean): Promise<CredentialsFixture> {
  const configDir = path.join(os.tmpdir(), `claw-e2e-creds-${randomUUID()}`);
  await fsp.mkdir(configDir, { recursive: true });

  const creds = authenticated
    ? {
        claudeAiOauth: {
          accessToken: 'e2e-fake-access-token',
          refreshToken: 'e2e-fake-refresh-token',
          expiresAt: Date.now() + 3_600_000,
          scopes: ['user:inference'],
        },
      }
    : {};

  await fsp.writeFile(path.join(configDir, '.credentials.json'), JSON.stringify(creds), 'utf8');

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
