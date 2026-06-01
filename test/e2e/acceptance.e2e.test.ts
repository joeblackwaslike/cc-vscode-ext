import { expect, test, FrameLocator } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { runCommand, webviewFrame } from './helpers/panel';

/** Navigate past the welcome screen into a conversation view if needed. */
async function ensureConversationView(frame: FrameLocator): Promise<void> {
  const either = frame.locator('[data-testid="welcome-screen"], [data-testid="conversation-view"]');
  await expect(either.first()).toBeVisible({ timeout: 15_000 });
  if (await frame.getByTestId('welcome-screen').isVisible()) {
    await frame.getByTestId('new-session-button').click();
  }
  await expect(frame.getByTestId('conversation-view')).toBeVisible({ timeout: 15_000 });
}

test.describe('Acceptance: Claude Code extension', () => {
  test('extension activates and panel UI renders', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = webviewFrame(window);
      await ensureConversationView(frame);
      await expect(frame.getByTestId('message-input')).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('user can type and submit a message', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = webviewFrame(window);
      await ensureConversationView(frame);
      const input = frame.getByTestId('message-input');
      await expect(input).toBeVisible({ timeout: 10_000 });

      await input.fill('hello');
      const sendButton = frame.getByTestId('send-button');
      await expect(sendButton).toBeVisible({ timeout: 5_000 });
      await sendButton.click();

      // User message bubble appears immediately (optimistic update)
      await expect(frame.getByTestId('chat-message-user').first()).toBeVisible({
        timeout: 10_000,
      });
      // Interrupt button confirms the message was dispatched to the Claude process
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

    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(3_000);

      const frame = webviewFrame(window);
      await ensureConversationView(frame);
      const input = frame.getByTestId('message-input');
      await expect(input).toBeVisible({ timeout: 10_000 });

      await input.fill('respond with exactly the word OK and nothing else');
      await frame.getByTestId('send-button').click();

      // User message confirms the send went through
      await expect(frame.getByTestId('chat-message-user').first()).toBeVisible({
        timeout: 10_000,
      });
      // Interrupt button disappearing means Claude finished processing
      await expect(frame.getByTestId('interrupt-button')).toBeHidden({ timeout: 30_000 });
      // Claude response is present
      await expect(frame.getByTestId('chat-message-assistant').first()).toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await closeVSCode(result);
    }
  });
});
