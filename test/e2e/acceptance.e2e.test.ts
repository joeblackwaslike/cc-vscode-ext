import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { getWebviewFrame, runCommand } from './helpers/panel';

// VS Code launch + webview init reliably needs more than the default 60s.
const ACCEPTANCE_TIMEOUT = 120_000;

test.describe('Acceptance: Claude Code extension', () => {
  test('extension activates and panel UI renders', async () => {
    test.setTimeout(ACCEPTANCE_TIMEOUT);
    const result = await launchVSCode();
    try {
      const { window } = result;

      await runCommand(window, 'Claude Code: Open in New Tab');
      const frame = getWebviewFrame(window);

      // Either welcome screen (fresh install) or conversation view (existing sessions) is valid.
      const rootView = frame.locator(
        '[data-testid="welcome-screen"], [data-testid="conversation-view"]',
      );
      await expect(rootView.first()).toBeVisible({ timeout: 20_000 });
      await expect(frame.getByTestId('message-input')).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('user can type and submit a message', async () => {
    test.setTimeout(ACCEPTANCE_TIMEOUT);
    const result = await launchVSCode();
    try {
      const { window } = result;

      await runCommand(window, 'Claude Code: Open in New Tab');
      const frame = getWebviewFrame(window);

      const input = frame.getByTestId('message-input');
      await expect(input).toBeVisible({ timeout: 20_000 });

      await input.fill('hello');
      const sendButton = frame.getByTestId('send-button');
      await expect(sendButton).toBeVisible({ timeout: 5_000 });
      await sendButton.click();

      // User message bubble appears immediately (optimistic update).
      await expect(frame.getByTestId('chat-message-user').first()).toBeVisible({
        timeout: 10_000,
      });
      // Interrupt button confirms the message was dispatched to the Claude process.
      await expect(frame.getByTestId('interrupt-button')).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeVSCode(result);
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

      await runCommand(window, 'Claude Code: Open in New Tab');
      const frame = getWebviewFrame(window);

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
