import { createWriteStream, existsSync } from 'fs';
import { chmod, mkdir, rename, unlink, readFile } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { join } from 'path';
import * as https from 'https';
import { claudeCliVersion } from '../../package.json';

/**
 * The pinned Claude Code CLI version the extension ships + was tested against.
 * Single source of truth: the `claudeCliVersion` field in package.json, also
 * consumed by scripts/fetch-claude-binary.mjs and .github/workflows/claude-binaries.yml.
 *
 * Its per-platform binaries are published as assets on the `claude-cli-v<ver>`
 * GitHub release; the extension downloads the right one on first run (the
 * 211 MB binary is no longer committed to the repo). The pinned npm artifact
 * for each platform/arch is verified to be byte-identical (same SHA-256) to the
 * binary the live control-protocol probes ran against.
 */
export const CLAUDE_PINNED_VERSION: string = claudeCliVersion;

const RELEASE_REPO = 'joeblackwaslike/cc-vscode-ext';

/** The checksum manifest published alongside the per-platform binaries. */
const CHECKSUMS_ASSET = 'checksums.txt';

/** Abort a download/checksum fetch that stalls this long (ms). */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Release-asset name for a platform/arch, e.g. `claude-darwin-arm64`. */
export function assetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `claude-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}

/** Public download URL for a release asset. */
export function releaseAssetUrl(version: string, asset: string, repo: string = RELEASE_REPO): string {
  return `https://github.com/${repo}/releases/download/claude-cli-v${version}/${asset}`;
}

export interface EnsureOptions {
  /** The extension's writable global storage dir (context.globalStorageUri.fsPath). */
  storageDir: string;
  version?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  /** A per-launch override (claudeProcessWrapper setting) — wins over everything. */
  wrapper?: string | undefined;
  log?: (msg: string) => void;
  /** Injectable for tests; defaults to a redirect-following https download. */
  download?: (url: string, dest: string) => Promise<void>;
  /**
   * Injectable for tests; returns the parsed `checksums.txt` map ({asset → sha256}).
   * When `download` is injected without this, checksum verification is skipped
   * (the test owns the transport). On the real path it defaults to fetching the
   * release manifest so a tampered asset can't run.
   */
  fetchChecksums?: (version: string) => Promise<Record<string, string>>;
  /** Injectable for tests; resolves a `claude` on PATH for the offline fallback. */
  resolvePathClaude?: () => string | null;
  /** Wrap the download in a UI progress indicator (vscode.window.withProgress). */
  withProgress?: <T>(title: string, task: () => Promise<T>) => PromiseLike<T>;
}

/**
 * Resolve the claude binary, downloading + caching the pinned release asset on
 * first use. Precedence: explicit wrapper → cached download → fresh download
 * (checksum-verified) → a `claude` on PATH (keeps dev/CI working before the
 * release exists) → error.
 */
export async function ensureClaudeBinary(opts: EnsureOptions): Promise<string> {
  if (opts.wrapper) return opts.wrapper;

  const version = opts.version ?? CLAUDE_PINNED_VERSION;
  const asset = assetName(opts.platform, opts.arch);
  const dir = join(opts.storageDir, 'claude-cli', version);
  const dest = join(dir, asset);

  if (existsSync(dest)) return dest;

  try {
    await mkdir(dir, { recursive: true });
    const url = releaseAssetUrl(version, asset);
    const download = opts.download ?? downloadFile;
    // Only auto-fetch checksums on the real transport. A test that injects its
    // own `download` must also inject `fetchChecksums` to exercise verification.
    const fetchChecksums = opts.fetchChecksums ?? (opts.download ? undefined : fetchReleaseChecksums);
    const run = opts.withProgress ?? ((_title, task) => task());
    await run(`Downloading Claude Code ${version}…`, () => download(url, dest));
    try {
      if (fetchChecksums) await verifyChecksum(dest, asset, version, fetchChecksums);
      await chmod(dest, 0o755);
    } catch (verifyErr) {
      // Never leave an unverified binary on disk — a later run would trust the
      // cached path via existsSync() without re-checking.
      await unlink(dest).catch(() => {});
      throw verifyErr;
    }
    return dest;
  } catch (err) {
    const onPath = (opts.resolvePathClaude ?? resolvePathClaude)();
    if (onPath) {
      opts.log?.(`Claude binary download failed (${String(err)}); falling back to PATH: ${onPath}`);
      return onPath;
    }
    throw new Error(`Failed to obtain the Claude Code ${version} binary (${asset}): ${String(err)}`);
  }
}

/** Compute the SHA-256 of `file` and verify it against the release manifest. */
async function verifyChecksum(
  file: string,
  asset: string,
  version: string,
  fetchChecksums: (version: string) => Promise<Record<string, string>>,
): Promise<void> {
  const checksums = await fetchChecksums(version);
  const expected = checksums[asset];
  if (!expected) {
    throw new Error(`No published checksum for ${asset} in ${CHECKSUMS_ASSET}`);
  }
  const actual = createHash('sha256').update(await readFile(file)).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
  }
}

/** Fetch + parse the release `checksums.txt` (`<sha256>  <filename>` per line). */
async function fetchReleaseChecksums(version: string): Promise<Record<string, string>> {
  const text = await httpsGetText(releaseAssetUrl(version, CHECKSUMS_ASSET));
  const map: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && m[1] && m[2]) map[m[2].trim()] = m[1];
  }
  return map;
}

/** Memoize the resolution so the ~200 MB download happens at most once per session. */
export function createBinaryProvider(opts: EnsureOptions): () => Promise<string> {
  let inflight: Promise<string> | undefined;
  return () => {
    if (!inflight) {
      // Don't memoize a rejection: a transient failure must not poison every
      // future call until the extension host reloads.
      inflight = ensureClaudeBinary(opts).catch((err) => {
        inflight = undefined;
        throw err;
      });
    }
    return inflight;
  };
}

/** Look up an executable `claude` on PATH (offline fallback). */
export function resolvePathClaude(): string | null {
  const sep = process.platform === 'win32' ? ';' : ':';
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const dir of (process.env.PATH ?? '').split(sep)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Download a URL to `dest` atomically (.partial → rename), following redirects. */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Unique per attempt — a fixed name collides on concurrent first-run
    // downloads (multiple windows/processes) and corrupts the write.
    const tmp = `${dest}.${randomUUID()}.partial`;
    const file = createWriteStream(tmp);
    const fail = (err: Error) => {
      file.destroy();
      // Don't orphan the half-written temp file in global storage.
      void unlink(tmp).catch(() => {});
      reject(err);
    };

    const get = (current: string, redirects: number): void => {
      const req = https.get(current, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects > 5) return fail(new Error('too many redirects'));
          return get(new URL(res.headers.location, current).toString(), redirects + 1);
        }
        if (status !== 200) {
          res.resume();
          return fail(new Error(`HTTP ${status} for ${current}`));
        }
        // pipe() does not forward source errors — listen before piping or an
        // unhandled 'error' on res crashes the host.
        res.on('error', fail);
        res.pipe(file);
        file.on('finish', () => file.close(() => rename(tmp, dest).then(resolve, fail)));
      });
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('download timed out')));
      req.on('error', fail);
    };

    file.on('error', fail);
    get(url, 0);
  });
}

/** GET a URL as text, following redirects, with a stall timeout. */
function httpsGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const get = (current: string, redirects: number): void => {
      const req = https.get(current, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects > 5) return reject(new Error('too many redirects'));
          return get(new URL(res.headers.location, current).toString(), redirects + 1);
        }
        if (status !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${status} for ${current}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('error', reject);
        res.on('end', () => resolve(body));
      });
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('download timed out')));
      req.on('error', reject);
    };
    get(url, 0);
  });
}
