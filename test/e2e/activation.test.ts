import { expect, test } from '@playwright/test';
import { commandExists, openCommandPalette } from './helpers/panel';
import { closeVSCode, launchVSCode } from './helpers/launch';

const CLAUDE_COMMANDS = [
  'Claude Code: Open in New Tab',
  'Claude Code: Open',
  'Claude Code: New Conversation',
  'Claude Code: Open in Terminal',
  'Claude Code: Show Logs',
];

test.describe('Extension activation', () => {
  test('VS Code launches with a visible window', async () => {
    const result = await launchVSCode();
    try {
      const title = await result.window.title();
      expect(title).toBeTruthy();
      expect(await result.window.isVisible('body')).toBe(true);
    } finally {
      await closeVSCode(result);
    }
  });

  test('Claude commands appear in command palette', async () => {
    const result = await launchVSCode();
    try {
      await openCommandPalette(result.window);
      await result.window.locator('.quick-input-widget .input').fill('Claude Code:');
      await result.window.waitForTimeout(800);
      const items = await result.window.locator('.quick-input-list .label-name').allTextContents();
      await result.window.keyboard.press('Escape');

      const claudeItems = items.filter((t) => t.startsWith('Claude Code'));
      expect(claudeItems.length).toBeGreaterThanOrEqual(CLAUDE_COMMANDS.length / 2);
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
