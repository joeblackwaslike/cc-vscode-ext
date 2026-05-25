import { expect, test } from '@playwright/test';
import { getWebviewFrame, runCommand } from './helpers/panel';
import { launchVSCode } from './helpers/launch';

test.describe('Claude panel', () => {
  test('Open in New Tab command creates an editor tab', async () => {
    const { app, window } = await launchVSCode();
    try {
      await runCommand(window, 'Claude Code: Open in New Tab');
      // A new editor tab should appear with Claude-related title
      await window.waitForTimeout(2_000);
      const tabs = await window.locator('.tab .tab-label').allTextContents();
      const hasClaudeTab = tabs.some((t) => /claude/i.test(t));
      expect(hasClaudeTab).toBe(true);
    } finally {
      await app.close();
    }
  });

  test('webview iframe loads after opening panel', async () => {
    const { app, window } = await launchVSCode();
    try {
      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = getWebviewFrame(window);
      // The webview document should have a body element
      const body = frame.locator('body');
      await expect(body).toBeAttached({ timeout: 15_000 });
    } finally {
      await app.close();
    }
  });

  test('welcome screen renders inside the webview', async () => {
    const { app, window } = await launchVSCode();
    try {
      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = getWebviewFrame(window);
      // Wait for the React root to render — either welcome screen or session list
      const welcomeOrApp = frame.locator('[data-testid="welcome-screen"], #root');
      await expect(welcomeOrApp.first()).toBeAttached({ timeout: 15_000 });
    } finally {
      await app.close();
    }
  });
});
