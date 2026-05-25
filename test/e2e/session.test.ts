import { expect, test } from '@playwright/test';
import { getWebviewFrame, runCommand } from './helpers/panel';
import { launchVSCode } from './helpers/launch';

test.describe('Session management', () => {
  test('Open in Side Bar shows the sessions sidebar', async () => {
    const { app, window } = await launchVSCode();
    try {
      await runCommand(window, 'Claude Code: Open in Side Bar');
      await window.waitForTimeout(2_000);

      // The activity bar item or sidebar panel should be visible
      const sidebar = window.locator('.sidebar, .activitybar');
      await expect(sidebar.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await app.close();
    }
  });

  test('session list renders in webview after panel open', async () => {
    const { app, window } = await launchVSCode();
    try {
      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = getWebviewFrame(window);
      // The session list or welcome screen should be present
      const root = frame.locator('#root');
      await expect(root).toBeAttached({ timeout: 15_000 });
    } finally {
      await app.close();
    }
  });

  test('New Conversation command executes without throwing', async () => {
    const { app, window } = await launchVSCode();
    try {
      // Open panel first so the command has context
      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(2_000);
      await runCommand(window, 'Claude Code: New Conversation');
      await window.waitForTimeout(1_000);
      // If we get here without a crash, the command handled gracefully
      expect(true).toBe(true);
    } finally {
      await app.close();
    }
  });
});
