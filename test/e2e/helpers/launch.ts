import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

function findVSCodeBinary(): string {
  if (process.env.VSCODE_BIN) return process.env.VSCODE_BIN;

  const cacheDir = path.resolve(__dirname, '../../../.vscode-test');
  let entries: string[];
  try {
    entries = fs.readdirSync(cacheDir).filter((e) => e.startsWith('vscode-'));
  } catch {
    throw new Error(`Could not read .vscode-test/: ${cacheDir}`);
  }

  entries.sort().reverse(); // newest version first
  for (const entry of entries) {
    const bin = path.join(cacheDir, entry, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron');
    if (fs.existsSync(bin)) return bin;
  }

  throw new Error(
    'No VS Code binary found in .vscode-test/. Run `npm run test:integration` once to download it, or set VSCODE_BIN.',
  );
}

export async function launchVSCode(): Promise<{ app: ElectronApplication; window: Page }> {
  const executablePath = findVSCodeBinary();
  const extensionPath = path.resolve(__dirname, '../../..');

  const app = await electron.launch({
    executablePath,
    args: [
      `--extensionDevelopmentPath=${extensionPath}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--disable-telemetry',
      '--no-sandbox',
      '--disable-gpu',
    ],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2_000);

  return { app, window };
}
