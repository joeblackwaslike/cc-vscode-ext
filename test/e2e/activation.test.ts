import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { commandExists, openCommandPalette } from './helpers/panel';

const CLAUDE_COMMANDS_PREFIX = 'Claw Code:';
const MIN_CLAUDE_COMMANDS = 5;

test.describe('Extension activation', () => {
  test('VS Code launches with a visible workbench', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      const title = await window.title();
      expect(title).toBeTruthy();
      await expect(window.locator('.monaco-workbench')).toBeVisible();
    } finally {
      await closeVSCode(result);
    }
  });

  test('Claude commands appear in command palette', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await openCommandPalette(window);
      await window.locator('.quick-input-widget input').fill(`>${CLAUDE_COMMANDS_PREFIX}`);
      await window.waitForTimeout(800);
      const items = await window.locator('.quick-input-list .label-name').allTextContents();
      await window.keyboard.press('Escape');

      const claudeItems = items.filter((t) => t.startsWith(CLAUDE_COMMANDS_PREFIX));
      expect(claudeItems.length).toBeGreaterThanOrEqual(MIN_CLAUDE_COMMANDS);
    } finally {
      await closeVSCode(result);
    }
  });

  test('no uncaught errors from the extension on startup', async () => {
    const errors: string[] = [];
    const result = await launchVSCode();
    try {
      result.window.on('pageerror', (err) => {
        if (/claude/i.test(err.message)) errors.push(err.message);
      });
      await result.window.waitForTimeout(3_000);
      expect(errors).toHaveLength(0);
    } finally {
      await closeVSCode(result);
    }
  });
});
