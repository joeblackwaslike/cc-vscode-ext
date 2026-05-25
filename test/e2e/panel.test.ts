import { expect, test } from '@playwright/test';
import { webviewFrame, runCommand } from './helpers/panel';
import { closeVSCode, launchVSCode } from './helpers/launch';

test.describe('Claude panel', () => {
  test('Open in New Tab command creates an editor tab', async () => {
    const result = await launchVSCode();
    try {
      await runCommand(result.window, 'Claude Code: Open in New Tab');
      await result.window.waitForTimeout(2_000);
      const tabs = await result.window.locator('.tab .tab-label').allTextContents();
      const hasClaudeTab = tabs.some((t) => /claude/i.test(t));
      expect(hasClaudeTab).toBe(true);
    } finally {
      await closeVSCode(result);
    }
  });

  test('webview iframe loads after opening panel', async () => {
    const result = await launchVSCode();
    try {
      await runCommand(result.window, 'Claude Code: Open in New Tab');
      await result.window.waitForTimeout(3_000);

      const frame = webviewFrame(result.window);
      const body = frame.locator('body');
      await expect(body).toBeAttached({ timeout: 15_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('welcome screen renders inside the webview', async () => {
    const result = await launchVSCode();
    try {
      await runCommand(result.window, 'Claude Code: Open in New Tab');
      await result.window.waitForTimeout(3_000);

      const frame = webviewFrame(result.window);
      const welcomeOrApp = frame.locator('[data-testid="welcome-screen"], #root');
      await expect(welcomeOrApp.first()).toBeAttached({ timeout: 15_000 });
    } finally {
      await closeVSCode(result);
    }
  });
});
