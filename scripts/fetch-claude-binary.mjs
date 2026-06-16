#!/usr/bin/env node
/**
 * Fetch the pinned per-platform claude CLI binary from npm and write it to a
 * target path. The binary is no longer committed to the repo — it's published as
 * a GitHub Release asset and downloaded by the extension on first run. This
 * script is the build-time/CI equivalent (and the release workflow's inner loop).
 *
 * Usage:
 *   node scripts/fetch-claude-binary.mjs [platform] [arch] [destPath]
 * Defaults: host platform/arch → resources/native-binary/claude
 *
 * Keep VERSION in sync with CLAUDE_PINNED_VERSION in src/process/ClaudeBinary.ts.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2.1.168';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2] || process.platform; // darwin | linux | win32
const arch = process.argv[3] || process.arch; // arm64 | x64
const dest = process.argv[4] || join(repoRoot, 'resources', 'native-binary', 'claude');

const pkg = `@anthropic-ai/claude-code-${platform}-${arch}@${VERSION}`;
const exe = platform === 'win32' ? 'claude.exe' : 'claude';

const tmp = mkdtempSync(join(tmpdir(), 'claude-pack-'));
const tarball = execFileSync('npm', ['pack', pkg, '--silent', '--pack-destination', tmp], {
  encoding: 'utf8',
}).trim();

execFileSync('tar', ['xzf', join(tmp, tarball), '-C', tmp]);

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(join(tmp, 'package', exe), dest);
if (platform !== 'win32') chmodSync(dest, 0o755);

console.log(`fetched ${pkg} → ${dest}`);
