import { chromium, Browser, Page } from '@playwright/test';
import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Fixed CDP port — safe because we run workers:1 (serial tests).
const CDP_PORT = 9500;

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

export interface LaunchResult {
  browser: Browser;
  window: Page;
  vscodeProcess: ChildProcess;
  userDataDir: string;
}

export async function launchVSCode(): Promise<LaunchResult> {
  const codeBin = findVSCodeCode();
  const userDataDir = path.join(os.tmpdir(), `vscode-e2e-${randomUUID()}`);
  await fsp.mkdir(path.join(userDataDir, 'extensions'), { recursive: true });

  const vscodeProcess = spawn(
    codeBin,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--extensionDevelopmentPath=${REPO_ROOT}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${path.join(userDataDir, 'extensions')}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      '--no-sandbox',
      '--disable-gpu',
      userDataDir,
    ],
    { detached: false, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } },
  );

  vscodeProcess.on('error', (err) => console.error('[vscode] spawn error:', err));

  // Wait for VS Code's CDP endpoint to become available.
  await waitForCDP(CDP_PORT, 40_000);

  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('No browser contexts after CDP connect');

  // Find the VS Code workbench page (not a vscode-webview:// renderer).
  const window: Page = (() => {
    for (const ctx of contexts) {
      const p = ctx.pages().find((pg) => !pg.url().startsWith('vscode-webview://'));
      if (p) return p;
    }
    const fallback = contexts[0]?.pages()[0];
    if (!fallback) throw new Error('No VS Code workbench page found after CDP connect');
    return fallback;
  })();

  await window.waitForLoadState('domcontentloaded');
  await window.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 30_000 });

  return { browser, window, vscodeProcess, userDataDir };
}

export async function closeVSCode(result: LaunchResult): Promise<void> {
  try { await result.browser.close(); } catch { /* ignore */ }
  try { result.vscodeProcess.kill(); } catch { /* ignore */ }
  try { await fsp.rm(result.userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
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
