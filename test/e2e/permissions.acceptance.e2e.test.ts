import { expect, test } from '@playwright/test';
import type { FrameLocator } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { getWebviewFrame, runCommand } from './helpers/panel';

const TURN_TIMEOUT = 240_000;
const PROMPT_TIMEOUT = 150_000;

const ASK_PROMPT =
  'Use the AskUserQuestion tool exactly once to ask me two questions: ' +
  '(1) "Favorite color?" with options Red and Blue, single select, header "Color"; ' +
  '(2) "Which pets?" with options Cat, Dog, Fish, multiSelect true, header "Pets". ' +
  'After I answer, reply with my answers verbatim and nothing else.';

const PLAN_PROMPT =
  'Plan creating a file named e2e-hello.txt containing hi. Do not explore the codebase. ' +
  'Present the plan with ExitPlanMode immediately.';

async function openConversation(frame: FrameLocator): Promise<void> {
  await expect(frame.getByTestId('message-input')).toBeVisible({ timeout: 20_000 });
}

async function pickMode(frame: FrameLocator, label: string): Promise<void> {
  const selector = frame.getByTestId('mode-selector');
  await selector.click();
  await frame.getByRole('menuitem', { name: label }).click();
  await expect(selector).toContainText(label);
}

async function send(frame: FrameLocator, text: string): Promise<void> {
  await frame.getByTestId('message-input').fill(text);
  await frame.getByTestId('send-button').click();
  await expect(frame.getByTestId('chat-message-user').first()).toBeVisible({ timeout: 10_000 });
}

/** Deny any follow-up tool card (e.g. Write) and stop the turn, so nothing is written. */
async function winddown(frame: FrameLocator): Promise<void> {
  const dock = frame.getByTestId('permission-dock');
  const interrupt = frame.getByTestId('interrupt-button');
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await dock.getByRole('button', { name: 'Deny' }).isVisible()) {
      await dock.getByRole('button', { name: 'Deny' }).click();
    } else if (await interrupt.isVisible()) {
      await interrupt.click();
    } else {
      return;
    }
    await frame.owner().page().waitForTimeout(500);
  }
}

test.describe('Acceptance: permission prompts round-trip through the real CLI', () => {
  test.skip(
    !process.env.CLAUDE_ACCEPTANCE,
    'set CLAUDE_ACCEPTANCE=1 to run (requires claude CLI in PATH + auth)',
  );

  test('AskUserQuestion answers reach Claude', async () => {
    test.setTimeout(TURN_TIMEOUT);
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      await openConversation(frame);
      await pickMode(frame, 'Ask permissions');
      await send(frame, ASK_PROMPT);

      const dock = frame.getByTestId('permission-dock');
      await expect(dock.getByRole('button', { name: 'Submit answers' })).toBeVisible({
        timeout: PROMPT_TIMEOUT,
      });

      await dock.getByRole('radio', { name: /Blue/ }).click();
      await dock.getByRole('tab', { name: 'Pets' }).click();
      await dock.getByRole('checkbox', { name: /Cat/ }).click();
      await dock.getByRole('checkbox', { name: /Dog/ }).click();
      await dock.getByRole('checkbox', { name: /Other/ }).click();
      await dock.getByPlaceholder('Type your answer…').fill('Llama');
      await dock.getByRole('button', { name: 'Submit answers' }).click();

      await expect(frame.getByTestId('permission-dock')).toHaveCount(0, { timeout: 10_000 });
      await expect(frame.getByTestId('ask-user-question-block')).toContainText('2 questions');

      const reply = frame.getByTestId('chat-message-assistant').last();
      await expect(reply).toContainText('Blue', { timeout: PROMPT_TIMEOUT });
      await expect(reply).toContainText('Llama');
    } finally {
      await closeVSCode(result);
    }
  });

  test('ExitPlanMode manual approval switches mode', async () => {
    test.setTimeout(TURN_TIMEOUT);
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      await openConversation(frame);
      await pickMode(frame, 'Plan mode');
      await send(frame, PLAN_PROMPT);

      const dock = frame.getByTestId('permission-dock');
      await expect(dock).toContainText('Accept this plan?', { timeout: PROMPT_TIMEOUT });
      await dock.getByRole('button', { name: /Yes, and manually approve edits/ }).click();

      await expect(dock.getByText('Accept this plan?')).toHaveCount(0, { timeout: 10_000 });
      await expect(frame.getByTestId('exit-plan-mode-block')).toContainText('User approved the plan', {
        timeout: 30_000,
      });
      await expect(frame.getByTestId('mode-selector')).not.toContainText('Plan mode');

      await winddown(frame);
    } finally {
      await closeVSCode(result);
    }
  });

  test('Keep planning sends feedback', async () => {
    test.setTimeout(TURN_TIMEOUT);
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Open in New Tab');
      const frame = getWebviewFrame(window);
      await openConversation(frame);
      await pickMode(frame, 'Plan mode');
      await send(frame, PLAN_PROMPT);

      const dock = frame.getByTestId('permission-dock');
      await expect(dock).toContainText('Accept this plan?', { timeout: PROMPT_TIMEOUT });
      await dock.getByLabel('Feedback').fill('use bye.txt instead');
      const keepPlanning = dock.getByRole('button', { name: /Send feedback and keep planning/ });
      await expect(keepPlanning).toBeVisible();
      await keepPlanning.click();

      await expect(frame.getByTestId('exit-plan-mode-block')).toContainText('Stayed in plan mode', {
        timeout: 30_000,
      });
      await expect(dock.getByText('Accept this plan?')).toHaveCount(0, { timeout: 10_000 });

      await winddown(frame);
    } finally {
      await closeVSCode(result);
    }
  });
});
