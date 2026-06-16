#!/usr/bin/env node
/**
 * Cross-platform safe E2E runner (replaces the bash-only scripts/e2e.sh so
 * `npm run test:e2e` works on Windows shells that lack bash too).
 *
 * Guarantees, layered on top of the in-process cap + globalSetup/globalTeardown
 * sweeps and the per-pid kills in test/e2e/helpers/registry.ts:
 *   - a wall-clock timeout so a hung run can't sit open forever, and
 *   - a final sweep of any VS Code instance the suite spawned (tagged with the
 *     'vscode-e2e-' user-data-dir marker) however Playwright exits.
 */
import { spawn, spawnSync } from 'node:child_process';

const MARKER = 'vscode-e2e-';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT ?? 600) * 1000;
const isWin = process.platform === 'win32';

/** Best-effort kill of any stray VS Code instances tagged with our marker. */
function sweepStrays() {
  try {
    if (isWin) {
      // No pkill on Windows; match the marker in the command line via WMIC.
      spawnSync('wmic', ['process', 'where', `CommandLine like '%${MARKER}%'`, 'call', 'terminate'], {
        stdio: 'ignore',
      });
    } else {
      spawnSync('pkill', ['-9', '-f', MARKER], { stdio: 'ignore' });
    }
  } catch {
    /* sweeper unavailable — registry.ts already killed tracked pids */
  }
}

const args = process.argv.slice(2);
const child = spawn('npx', ['playwright', 'test', '--config', 'playwright.e2e.config.ts', ...args], {
  stdio: 'inherit',
  shell: isWin, // npx resolves to npx.cmd on Windows
});

const timer = setTimeout(() => {
  process.exitCode = 124; // conventional timeout code
  child.kill('SIGKILL');
}, TIMEOUT_MS);

const onSignal = () => child.kill('SIGKILL');
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  sweepStrays();
  if (process.exitCode === undefined) {
    process.exitCode = signal ? 1 : (code ?? 0);
  }
});
