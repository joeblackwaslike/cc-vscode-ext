import { chromium, Browser, Page } from '@playwright/test';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  assertUnderCap,
  killTree,
  registerInstance,
  unregisterInstance,
} from './registry';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function findVSCodeCode(): string {
  const cacheDir = path.join(REPO_ROOT, '.vscode-test');
  let entries: string[];
  try {
    entries = fs.readdirSync(cacheDir).filter((e) => e.startsWith('vscode-'));
  } catch {
    throw new Error(
      `Could not read .vscode-test/. Run \`npm run test:integration\` once to download VS Code.`,
    );
  }

  entries.sort().reverse();
  for (const entry of entries) {
    // Use the 'Code' launcher binary — it accepts VS Code flags including
    // --remote-debugging-port (the raw 'Electron' binary rejects it).
    const code = path.join(cacheDir, entry, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Code');
    if (fs.existsSync(code)) return code;
  }
  throw new Error('No VS Code binary found. Run `npm run test:integration` once to download it.');
}

function findVsix(): string {
  const entries = fs
    .readdirSync(REPO_ROOT)
    .filter((e) => e.endsWith('.vsix'))
    .map((e) => path.join(REPO_ROOT, e));
  if (entries.length === 0) {
    throw new Error('No .vsix found in repo root. Run `npm run package` before E2E_TARGET=vsix.');
  }
  // Newest by mtime.
  entries.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return entries[0];
}

export interface LaunchOptions {
  /** 'dev' = run from source (--extensionDevelopmentPath); 'vsix' = install the packaged artifact first. */
  target?: 'dev' | 'vsix';
  /** Extra env vars merged into the spawned VS Code process (e.g. CLAUDE_CONFIG_DIR). */
  env?: Record<string, string>;
}

export interface LaunchResult {
  browser: Browser;
  window: Page;
  vscodeProcess: ChildProcess;
  userDataDir: string;
}

export async function launchVSCode(opts: LaunchOptions = {}): Promise<LaunchResult> {
  // Fork-bomb stop: refuse to spawn if too many instances are already live.
  // Throws (spawning nothing) rather than melting the machine.
  assertUnderCap();

  const target = opts.target ?? (process.env.E2E_TARGET as 'dev' | 'vsix' | undefined) ?? 'dev';
  const codeBin = findVSCodeCode();
  const userDataDir = path.join(os.tmpdir(), `vscode-e2e-${randomUUID()}`);
  await fsp.mkdir(path.join(userDataDir, 'extensions'), { recursive: true });

  const cdpPort = await findFreePort();

  if (target === 'vsix') {
    const vsix = findVsix();
    const install = spawnSync(
      codeBin,
      ['--install-extension', vsix, '--extensions-dir', path.join(userDataDir, 'extensions')],
      { stdio: 'inherit' },
    );
    if (install.status !== 0) {
      throw new Error(`Failed to install ${vsix} (exit ${install.status ?? 'null'}).`);
    }
  }

  const vscodeProcess = spawn(
    codeBin,
    [
      `--remote-debugging-port=${cdpPort}`,
      ...(target === 'dev' ? [`--extensionDevelopmentPath=${REPO_ROOT}`] : []),
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${path.join(userDataDir, 'extensions')}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      '--no-sandbox',
      '--disable-gpu',
      '--headless',
      '--remote-allow-origins=*',
      userDataDir,
    ],
    // detached: true makes this VS Code its own process-group leader, so a hard
    // crash + killTree() can take down every Electron helper it spawns — no orphans.
    { detached: true, env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_NO_ATTACH_CONSOLE')), ELECTRON_ENABLE_LOGGING: '0', ...opts.env } },
  );

  // Record the instance immediately so a crash between here and closeVSCode()
  // still leaves a trail for the pre-flight / teardown sweeps to clean up.
  if (vscodeProcess.pid != null) registerInstance(vscodeProcess.pid, userDataDir);

  vscodeProcess.on('error', (err) => console.error('[vscode] spawn error:', err));

  try {
    // Wait for VS Code's CDP endpoint to become available.
    await waitForCDP(cdpPort, 60_000);

    // HTTP readiness doesn't guarantee the WebSocket endpoint is up yet.
    // Retry connectOverCDP with short per-attempt timeouts instead of one
    // long single attempt so we recover quickly once the WS becomes ready.
    const browser = await connectOverCDPWithRetry(cdpPort, 60_000);

    // The workbench renderer target often attaches a beat after connectOverCDP
    // returns, so reading pages() once races and finds an empty/webview-only
    // list. Poll until the workbench page appears instead.
    const window = await waitForWorkbenchPage(browser, 30_000);

    await window.waitForLoadState('domcontentloaded');
    await window.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 30_000 });

    return { browser, window, vscodeProcess, userDataDir };
  } catch (err) {
    if (vscodeProcess.pid != null) {
      killTree(vscodeProcess.pid);
      unregisterInstance(vscodeProcess.pid);
    }
    try { await fsp.rm(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}

export async function closeVSCode(result: LaunchResult): Promise<void> {
  const pid = result.vscodeProcess.pid;
  try { await result.browser.close(); } catch { /* ignore */ }
  try {
    // Kill the whole process group, not just the launcher, so Electron helpers
    // die with it. Then wait for exit so the next test doesn't inherit a
    // still-dying instance that holds ports/memory.
    if (pid != null) killTree(pid);
    await new Promise<void>((resolve) => {
      result.vscodeProcess.once('exit', () => resolve());
      setTimeout(resolve, 5_000); // fallback: don't block more than 5s
    });
  } catch { /* ignore */ }
  if (pid != null) unregisterInstance(pid);
  try { await fsp.rm(result.userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Wait for VS Code's workbench renderer page to attach as a CDP target. New
 * targets (the workbench, then webviews) appear over the contexts/pages list
 * a moment after connect, so we re-read every poll rather than once. Returns
 * the first non-webview page; if only webview pages ever appear, returns the
 * first page seen (the caller's `.monaco-workbench` check will then assert).
 */
async function waitForWorkbenchPage(browser: Browser, timeoutMs: number): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  let anyPage: Page | undefined;
  while (Date.now() < deadline) {
    for (const ctx of browser.contexts()) {
      for (const pg of ctx.pages()) {
        anyPage ??= pg;
        if (!pg.url().startsWith('vscode-webview://')) return pg;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (anyPage) return anyPage;
  throw new Error('No VS Code workbench page found after CDP connect');
}

async function waitForCDP(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`VS Code CDP did not become available on port ${port} within ${timeoutMs}ms`);
}

async function connectOverCDPWithRetry(port: number, totalTimeoutMs: number): Promise<Browser> {
  const deadline = Date.now() + totalTimeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://localhost:${port}`, { timeout: 5_000 });
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw lastError ?? new Error(`connectOverCDP failed on port ${port} within ${totalTimeoutMs}ms`);
}
