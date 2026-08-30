import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { getWebviewFrame, runCommand } from './helpers/panel';
import { WelcomePage } from './helpers/welcome';
import { seedCredentials } from './helpers/credentials';

// VS Code launch + webview init reliably needs more than the default 60s.
const TIMEOUT = 120_000;

// Deterministic UI flows for the composer + tab surface. These exercise local
// state (optimistic selectors, tab bar) and don't require a live model turn —
// the usage ring / breakdown popover need real token usage and stay unit-tested.
// Spawns one capped VS Code instance per test (registry MAX_CONCURRENT = 2).
test.describe('Composer controls + tabs', () => {
  test('composer shows mode/model/effort selectors and the add button', async () => {
    test.setTimeout(TIMEOUT);
    const creds = await seedCredentials(true);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      await new WelcomePage(frame).newConversationButton().click();

      await expect(frame.getByTestId('conversation-view')).toBeVisible({ timeout: 20_000 });
      await expect(frame.getByTestId('composer-add-button')).toBeVisible();
      await expect(frame.getByTestId('mode-selector')).toBeVisible();
      await expect(frame.getByTestId('model-selector')).toBeVisible();
      await expect(frame.getByTestId('effort-selector')).toBeVisible();
      // A tab + "+" new-tab + Past-conversations are present.
      await expect(frame.getByTestId('conversation-tab').first()).toBeVisible();
      await expect(frame.getByTestId('new-tab-button')).toBeVisible();
      await expect(frame.getByTestId('past-conversations-button')).toBeVisible();
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });

  test('choosing a model updates the selector pill immediately (live/optimistic)', async () => {
    test.setTimeout(TIMEOUT);
    const creds = await seedCredentials(true);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      await new WelcomePage(frame).newConversationButton().click();

      const model = frame.getByTestId('model-selector');
      await expect(model).toBeVisible({ timeout: 20_000 });
      await expect(model).toContainText('Default');

      await model.click();
      await frame.getByRole('menuitem', { name: /Sonnet/ }).click();

      await expect(model).toContainText('Sonnet');
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });

  test('the + button opens a new conversation tab', async () => {
    test.setTimeout(TIMEOUT);
    const creds = await seedCredentials(true);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      await new WelcomePage(frame).newConversationButton().click();

      await expect(frame.getByTestId('conversation-tab')).toHaveCount(1, { timeout: 20_000 });
      await frame.getByTestId('new-tab-button').click();
      await expect(frame.getByTestId('conversation-tab')).toHaveCount(2);
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });
});
