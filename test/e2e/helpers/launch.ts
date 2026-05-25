import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function findVSCodeBinary(): string {
  if (process.env.VSCODE_EXECUTABLE) return process.env.VSCODE_EXECUTABLE;

  const cacheDir = path.join(REPO_ROOT, '.vscode-test');
  let entries: string[];
  try {
    entries = fs.readdirSync(cacheDir).filter((e) => e.startsWith('vscode-'));
  } catch {
    throw new Error(
      `Could not read .vscode-test/. Run \`npm run test:integration\` once to download VS Code.`,
    );
  }

  entries.sort().reverse(); // newest version first
  for (const entry of entries) {
    // Try the `Code` launcher first; fall back to the raw `Electron` binary.
    for (const bin of ['Code', 'Electron']) {
      const fullPath = path.join(
        cacheDir,
        entry,
        'Visual Studio Code.app',
        'Contents',
        'MacOS',
        bin,
      );
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }

  throw new Error(
    'No VS Code binary found in .vscode-test/. Run `npm run test:integration` once to download it.',
  );
}

export interface LaunchResult {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
}

export async function launchVSCode(): Promise<LaunchResult> {
  const executablePath = findVSCodeBinary();
  const userDataDir = path.join(os.tmpdir(), `vscode-e2e-${randomUUID()}`);
  const extensionsDir = path.join(userDataDir, 'extensions');
  await fsp.mkdir(extensionsDir, { recursive: true });

  const app = await electron.launch({
    executablePath,
    args: [
      `--extensionDevelopmentPath=${REPO_ROOT}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      '--no-sandbox',
      '--disable-gpu',
      // Open an empty tmp folder so VS Code never restores a real workspace.
      userDataDir,
    ],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '0',
      VSCODE_SKIP_PRELAUNCH: '1',
    },
    timeout: 30_000,
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  // Wait for the workbench shell rather than a fixed delay.
  await window.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 30_000 });

  return { app, window, userDataDir };
}

export async function closeVSCode(result: LaunchResult): Promise<void> {
  try {
    await result.app.close();
  } catch {
    // Already closed — ignore.
  }
  try {
    await fsp.rm(result.userDataDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}
