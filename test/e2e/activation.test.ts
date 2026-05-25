import { expect, test } from '@playwright/test';
import { commandExists, openCommandPalette } from './helpers/panel';
import { launchVSCode } from './helpers/launch';

const CLAUDE_COMMANDS = [
  'Claude Code: Open in New Tab',
  'Claude Code: Open',
  'Claude Code: New Conversation',
  'Claude Code: Open in Terminal',
  'Claude Code: Show Logs',
];

test.describe('Extension activation', () => {
  test('VS Code launches with a visible window', async () => {
    const { app, window } = await launchVSCode();
    try {
      const title = await window.title();
      expect(title).toBeTruthy();
      expect(await window.isVisible('body')).toBe(true);
    } finally {
      await app.close();
    }
  });

  test('Claude commands appear in command palette', async () => {
    const { app, window } = await launchVSCode();
    try {
      await openCommandPalette(window);
      await window.locator('.quick-input-widget input').fill('Claude Code:');
      await window.waitForTimeout(800);
      const items = await window.locator('.quick-input-list .label-name').allTextContents();
      await window.keyboard.press('Escape');

      const claudeItems = items.filter((t) => t.startsWith('Claude Code'));
      expect(claudeItems.length).toBeGreaterThanOrEqual(CLAUDE_COMMANDS.length / 2);
    } finally {
      await app.close();
    }
  });

  test('no uncaught errors from the extension on startup', async () => {
    const errors: string[] = [];
    const { app, window } = await launchVSCode();
    try {
      window.on('pageerror', (err) => {
        if (/claude/i.test(err.message)) errors.push(err.message);
      });
      await window.waitForTimeout(3_000);
      expect(errors).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
