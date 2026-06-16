import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { getWebviewFrame, runCommand } from './helpers/panel';
import { WelcomePage } from './helpers/welcome';
import { seedCredentials } from './helpers/credentials';

// VS Code launch + webview init reliably needs more than the default 60s.
const ACCEPTANCE_TIMEOUT = 120_000;

const COMPOSE_PLACEHOLDER = 'Message Claude… (@ to mention files)';

test.describe('Acceptance: Claw Code extension', () => {
  test('extension activates and panel UI renders', async () => {
    test.setTimeout(ACCEPTANCE_TIMEOUT);
    const result = await launchVSCode();
    try {
      const { window } = result;

      await runCommand(window, 'Claw Code: Open in New Tab');
      const frame = getWebviewFrame(window);

      // Either welcome screen (fresh install) or conversation view (existing sessions) is valid.
      const rootView = frame.locator(
        '[data-testid="welcome-screen"], [data-testid="conversation-view"]',
      );
      await expect(rootView.first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  // Regression guard for the "stuck on Claude is thinking" bug: a brand-new
  // conversation must open with a usable, idle composer — a send button (not a
  // stop button) and the compose placeholder — before any stream event lands.
  test('a new conversation opens an idle, usable composer', async () => {
    test.setTimeout(ACCEPTANCE_TIMEOUT);
    const creds = await seedCredentials(true);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;

      await runCommand(window, 'Claw Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      const welcome = new WelcomePage(frame);

      await welcome.newConversationButton().click();

      await expect(frame.getByTestId('conversation-view')).toBeVisible({ timeout: 20_000 });
      await expect(frame.getByTestId('send-button')).toBeVisible({ timeout: 10_000 });
      await expect(frame.getByTestId('interrupt-button')).toHaveCount(0);
      await expect(frame.getByTestId('message-input')).toHaveAttribute(
        'placeholder',
        COMPOSE_PLACEHOLDER,
      );
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });

  test('user can type and submit a message', async () => {
    test.setTimeout(ACCEPTANCE_TIMEOUT);
    const creds = await seedCredentials(true);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;

      await runCommand(window, 'Claw Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      const welcome = new WelcomePage(frame);

      await welcome.newConversationButton().click();

      const input = frame.getByTestId('message-input');
      await expect(input).toBeVisible({ timeout: 20_000 });
      // Fresh state: the send button exists before we type anything.
      await expect(frame.getByTestId('send-button')).toBeVisible({ timeout: 10_000 });

      await input.fill('hello');
      await frame.getByTestId('send-button').click();

      // All client-side, independent of a live Claude CLI: the user's own turn
      // renders (the CLI stream doesn't echo it), the input clears, and the
      // composer flips to the running (interrupt) state.
      await expect(frame.getByTestId('chat-message-user').first()).toBeVisible({ timeout: 10_000 });
      await expect(frame.getByTestId('chat-message-user').first()).toContainText('hello');
      await expect(input).toHaveValue('');
      await expect(frame.getByTestId('interrupt-button')).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });

  test('full round-trip with Claude CLI', async () => {
    test.skip(
      !process.env.CLAUDE_ACCEPTANCE,
      'set CLAUDE_ACCEPTANCE=1 to run (requires claude CLI in PATH + auth)',
    );
    test.setTimeout(ACCEPTANCE_TIMEOUT);

    const result = await launchVSCode();
    try {
      const { window } = result;

      await runCommand(window, 'Claw Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      const welcome = new WelcomePage(frame);

      await welcome.newConversationButton().click();

      const input = frame.getByTestId('message-input');
      await expect(input).toBeVisible({ timeout: 20_000 });

      await input.fill('respond with exactly the word OK and nothing else');
      await frame.getByTestId('send-button').click();

      // User message confirms the send went through.
      await expect(frame.getByTestId('chat-message-user').first()).toBeVisible({
        timeout: 10_000,
      });
      // Interrupt button disappearing means Claude finished processing.
      await expect(frame.getByTestId('interrupt-button')).toBeHidden({ timeout: 30_000 });
      // Claude response is present.
      await expect(frame.getByTestId('chat-message-assistant').first()).toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await closeVSCode(result);
    }
  });
});
