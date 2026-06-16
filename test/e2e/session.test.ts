import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { getWebviewFrame, runCommand } from './helpers/panel';
import { WelcomePage } from './helpers/welcome';
import { seedCredentials } from './helpers/credentials';

test.describe('Session management', () => {
  test('Open in Side Bar shows the sidebar', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claw Code: Open in Side Bar');
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
      await runCommand(window, 'Claw Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = getWebviewFrame(window);
      const root = frame.locator('#root');
      await expect(root).toBeAttached({ timeout: 15_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('New Conversation opens a usable conversation view', async () => {
    const creds = await seedCredentials(true);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;
      await runCommand(window, 'Claw Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      const welcome = new WelcomePage(frame);

      await welcome.newConversationButton().click();

      // The conversation view appears with a working send button — not stuck on
      // a "Claude is thinking…" stop button.
      await expect(frame.getByTestId('conversation-view')).toBeVisible({ timeout: 20_000 });
      await expect(frame.getByTestId('send-button')).toBeVisible({ timeout: 10_000 });
      await expect(frame.getByTestId('interrupt-button')).toHaveCount(0);
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });
});
