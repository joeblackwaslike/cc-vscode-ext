import { createWriteStream, existsSync } from 'fs';
import { chmod, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import * as https from 'https';

/**
 * The pinned Claude Code CLI version the extension ships + was tested against.
 * Its per-platform binaries are published as assets on the `claude-cli-v<ver>`
 * GitHub release; the extension downloads the right one on first run (the
 * 211 MB binary is no longer committed to the repo). Verified: the npm artifact
 * `@anthropic-ai/claude-code-darwin-arm64@2.1.168` is byte-identical (same
 * SHA-256) to the binary the live control-protocol probes ran against.
 */
export const CLAUDE_PINNED_VERSION = '2.1.168';

const RELEASE_REPO = 'joeblackwaslike/cc-vscode-ext';

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
  /** Injectable for tests; resolves a `claude` on PATH for the offline fallback. */
  resolvePathClaude?: () => string | null;
  /** Wrap the download in a UI progress indicator (vscode.window.withProgress). */
  withProgress?: <T>(title: string, task: () => Promise<T>) => PromiseLike<T>;
}

/**
 * Resolve the claude binary, downloading + caching the pinned release asset on
 * first use. Precedence: explicit wrapper → cached download → fresh download →
 * a `claude` on PATH (keeps dev/CI working before the release exists) → error.
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
    const run = opts.withProgress ?? ((_title, task) => task());
    await run(`Downloading Claude Code ${version}…`, () => download(url, dest));
    await chmod(dest, 0o755);
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

/** Memoize the resolution so the ~200 MB download happens at most once per session. */
export function createBinaryProvider(opts: EnsureOptions): () => Promise<string> {
  let inflight: Promise<string> | undefined;
  return () => (inflight ??= ensureClaudeBinary(opts));
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
    const tmp = `${dest}.partial`;
    const file = createWriteStream(tmp);
    const fail = (err: Error) => {
      file.destroy();
      reject(err);
    };

    const get = (current: string, redirects: number): void => {
      https
        .get(current, (res) => {
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
          res.pipe(file);
          file.on('finish', () => file.close(() => rename(tmp, dest).then(resolve, fail)));
        })
        .on('error', fail);
    };

    file.on('error', fail);
    get(url, 0);
  });
}
