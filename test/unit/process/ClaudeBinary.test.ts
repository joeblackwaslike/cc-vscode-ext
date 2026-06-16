import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  assetName,
  releaseAssetUrl,
  ensureClaudeBinary,
  createBinaryProvider,
  CLAUDE_PINNED_VERSION,
} from '../../../src/process/ClaudeBinary';

const tmp = () => mkdtempSync(join(tmpdir(), 'cc-bin-'));

describe('assetName', () => {
  it('maps platform/arch to the release asset name', () => {
    expect(assetName('darwin', 'arm64')).toBe('claude-darwin-arm64');
    expect(assetName('linux', 'x64')).toBe('claude-linux-x64');
    expect(assetName('linux', 'arm64')).toBe('claude-linux-arm64');
    expect(assetName('win32', 'x64')).toBe('claude-win32-x64.exe');
  });
});

describe('releaseAssetUrl', () => {
  it('builds the version-tagged release download URL', () => {
    expect(releaseAssetUrl('2.1.168', 'claude-linux-x64')).toBe(
      'https://github.com/joeblackwaslike/cc-vscode-ext/releases/download/claude-cli-v2.1.168/claude-linux-x64',
    );
  });
});

describe('ensureClaudeBinary', () => {
  it('returns the wrapper override without touching the filesystem', async () => {
    const r = await ensureClaudeBinary({ storageDir: '/does/not/exist', wrapper: '/custom/claude' });
    expect(r).toBe('/custom/claude');
  });

  it('returns a cached binary without downloading', async () => {
    const dir = tmp();
    const cacheDir = join(dir, 'claude-cli', CLAUDE_PINNED_VERSION);
    mkdirSync(cacheDir, { recursive: true });
    const dest = join(cacheDir, assetName('darwin', 'arm64'));
    writeFileSync(dest, 'cached');
    const download = vi.fn();

    const r = await ensureClaudeBinary({ storageDir: dir, platform: 'darwin', arch: 'arm64', download });

    expect(r).toBe(dest);
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads the right asset URL to the cache path when absent', async () => {
    const dir = tmp();
    const asset = assetName('linux', 'x64');
    const dest = join(dir, 'claude-cli', CLAUDE_PINNED_VERSION, asset);
    const download = vi.fn(async (_url: string, d: string) => writeFileSync(d, 'bin'));

    const r = await ensureClaudeBinary({ storageDir: dir, platform: 'linux', arch: 'x64', download });

    expect(download).toHaveBeenCalledWith(releaseAssetUrl(CLAUDE_PINNED_VERSION, asset), dest);
    expect(r).toBe(dest);
    expect(existsSync(r)).toBe(true);
  });

  it('falls back to a PATH claude when the download fails', async () => {
    const download = vi.fn(async () => {
      throw new Error('offline');
    });
    const r = await ensureClaudeBinary({
      storageDir: tmp(),
      platform: 'linux',
      arch: 'x64',
      download,
      resolvePathClaude: () => '/usr/bin/claude',
    });
    expect(r).toBe('/usr/bin/claude');
  });

  it('throws when the download fails and no PATH claude exists', async () => {
    const download = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      ensureClaudeBinary({
        storageDir: tmp(),
        platform: 'linux',
        arch: 'x64',
        download,
        resolvePathClaude: () => null,
      }),
    ).rejects.toThrow(/Failed to obtain/);
  });
});

describe('createBinaryProvider', () => {
  it('memoizes so the download runs at most once', async () => {
    const download = vi.fn(async (_url: string, dest: string) => writeFileSync(dest, 'bin'));
    const provider = createBinaryProvider({ storageDir: tmp(), platform: 'linux', arch: 'x64', download });
    const a = await provider();
    const b = await provider();
    expect(a).toBe(b);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
