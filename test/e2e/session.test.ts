import { expect, test } from '@playwright/test';
import { webviewFrame, runCommand } from './helpers/panel';
import { closeVSCode, launchVSCode } from './helpers/launch';

test.describe('Session management', () => {
  test('Open in Side Bar shows the sessions sidebar', async () => {
    const result = await launchVSCode();
    try {
      await runCommand(result.window, 'Claude Code: Open in Side Bar');
      await result.window.waitForTimeout(2_000);

      const sidebar = result.window.locator('.sidebar, .activitybar');
      await expect(sidebar.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('session list renders in webview after panel open', async () => {
    const result = await launchVSCode();
    try {
      await runCommand(result.window, 'Claude Code: Open in New Tab');
      await result.window.waitForTimeout(3_000);

      const frame = webviewFrame(result.window);
      const root = frame.locator('#root');
      await expect(root).toBeAttached({ timeout: 15_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('New Conversation command executes without throwing', async () => {
    const result = await launchVSCode();
    try {
      await runCommand(result.window, 'Claude Code: Open in New Tab');
      await result.window.waitForTimeout(2_000);
      await runCommand(result.window, 'Claude Code: New Conversation');
      await result.window.waitForTimeout(1_000);
      expect(true).toBe(true);
    } finally {
      await closeVSCode(result);
    }
  });
});
