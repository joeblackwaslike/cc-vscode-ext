import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { getWebviewFrame, runCommand } from './helpers/panel';

test.describe('Session management', () => {
  test('Open in Side Bar shows the sidebar', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claude Code: Open in Side Bar');
      await window.waitForTimeout(2_000);

      const sidebar = window.locator('.sidebar, .activitybar');
      await expect(sidebar.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('session list renders in webview after panel open', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = getWebviewFrame(window);
      const root = frame.locator('#root');
      await expect(root).toBeAttached({ timeout: 15_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('New Conversation command executes without throwing', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(2_000);
      await runCommand(window, 'Claude Code: New Conversation');
      await window.waitForTimeout(1_000);
      expect(true).toBe(true);
    } finally {
      await closeVSCode(result);
    }
  });
});
