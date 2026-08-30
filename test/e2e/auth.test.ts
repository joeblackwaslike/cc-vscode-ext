import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { getWebviewFrame, runCommand } from './helpers/panel';
import { WelcomePage } from './helpers/welcome';
import { seedCredentials } from './helpers/credentials';

const AUTH_TIMEOUT = 120_000;

test.describe('Auth flow', () => {
  test('unauthenticated: sign-in screen shows and CLI auth opens a terminal', async () => {
    test.setTimeout(AUTH_TIMEOUT);
    const creds = await seedCredentials(false);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Open in New Tab');
      const welcome = new WelcomePage(getWebviewFrame(window));

      // The CLI auth button renders; the loginUrl-gated Sign In button does not.
      await expect(welcome.authenticateWithCliButton()).toBeVisible({ timeout: 20_000 });
      await expect(welcome.signInButton()).toHaveCount(0);

      // Clicking it is now handled: an integrated terminal opens (was a no-op).
      await welcome.authenticateWithCliButton().click();
      await expect(window.locator('.xterm').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });

  test('authenticated: no sign-in screen, conversation entry is reachable', async () => {
    test.setTimeout(AUTH_TIMEOUT);
    const creds = await seedCredentials(true);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Open in New Tab');
      const welcome = new WelcomePage(getWebviewFrame(window));

      await expect(welcome.newConversationButton()).toBeVisible({ timeout: 20_000 });
      await expect(welcome.authenticateWithCliButton()).toHaveCount(0);
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });
});
