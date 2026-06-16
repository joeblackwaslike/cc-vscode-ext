import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { getWebviewFrame, runCommand } from './helpers/panel';

test.describe('Claude panel', () => {
  test('Open in New Tab command creates an editor tab', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claw Code: Open in New Tab');
      // Poll for the editor tab to appear rather than a fixed sleep — the tab
      // label populates a beat after the command resolves.
      await expect
        .poll(
          async () => {
            const tabs = await window.locator('.tab .tab-label').allTextContents();
            return tabs.some((t) => /claw/i.test(t));
          },
          { timeout: 15_000 },
        )
        .toBe(true);
    } finally {
      await closeVSCode(result);
    }
  });

  test('webview iframe loads after opening panel', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claw Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = getWebviewFrame(window);
      await expect(frame.locator('body')).toBeAttached({ timeout: 15_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('welcome screen renders inside the webview', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claw Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = getWebviewFrame(window);
      const welcomeOrRoot = frame.locator('[data-testid="welcome-screen"], #root');
      await expect(welcomeOrRoot.first()).toBeAttached({ timeout: 15_000 });
    } finally {
      await closeVSCode(result);
    }
  });
});
