import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthChecker } from '../../../src/auth/AuthChecker';

describe('AuthChecker', () => {
  let dir: string;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `authchecker-${randomUUID()}`);
    await fsp.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  async function writeConfig(obj: unknown): Promise<void> {
    await fsp.writeFile(path.join(dir, '.claude.json'), JSON.stringify(obj), 'utf8');
  }

  it('returns authenticated when oauthAccount is present', async () => {
    await writeConfig({ oauthAccount: { accountUuid: 'abc', emailAddress: 'a@b.com' } });
    const result = await new AuthChecker(dir).checkAuth();
    expect(result.authenticated).toBe(true);
  });

  it('returns unauthenticated when oauthAccount is absent', async () => {
    await writeConfig({ numStartups: 3, hasCompletedOnboarding: true });
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });

  it('returns unauthenticated when oauthAccount is an empty object', async () => {
    await writeConfig({ oauthAccount: {} });
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });

  it('returns unauthenticated for a non-empty but malformed oauthAccount', async () => {
    await writeConfig({ oauthAccount: { foo: 'bar' } });
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });

  it('returns unauthenticated when the config file is missing', async () => {
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });

  it('returns unauthenticated for an unparseable config file', async () => {
    await fsp.writeFile(path.join(dir, '.claude.json'), 'not json', 'utf8');
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });
});
