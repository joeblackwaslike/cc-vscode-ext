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

  async function writeCreds(obj: unknown): Promise<void> {
    await fsp.writeFile(path.join(dir, '.credentials.json'), JSON.stringify(obj), 'utf8');
  }

  it('returns authenticated for a present, non-expired token', async () => {
    await writeCreds({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 } });
    const result = await new AuthChecker(dir).checkAuth();
    expect(result.authenticated).toBe(true);
  });

  it('returns unauthenticated for an expired token', async () => {
    await writeCreds({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() - 1_000 } });
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });

  it('returns unauthenticated when the credentials file is missing', async () => {
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });

  it('returns unauthenticated for unparseable credentials', async () => {
    await fsp.writeFile(path.join(dir, '.credentials.json'), 'not json', 'utf8');
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });
});
