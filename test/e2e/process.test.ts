import { expect, test } from '@playwright/test';
import { runCommand } from './helpers/panel';
import { launchVSCode } from './helpers/launch';

test.describe('Process and terminal integration', () => {
  test('Open in Terminal creates a named terminal', async () => {
    const { app, window } = await launchVSCode();
    try {
      await runCommand(window, 'Claude Code: Open in Terminal');
      await window.waitForTimeout(3_000);

      // The terminal panel should open
      const terminalPanel = window.locator('.terminal-outer-container, .panel.integrated-terminal');
      await expect(terminalPanel.first()).toBeAttached({ timeout: 10_000 });
    } finally {
      await app.close();
    }
  });

  test('Show Logs command opens an output channel', async () => {
    const { app, window } = await launchVSCode();
    try {
      await runCommand(window, 'Claude Code: Show Logs');
      await window.waitForTimeout(2_000);

      // The output panel should become visible
      const outputPanel = window.locator('.panel .output');
      await expect(outputPanel.first()).toBeAttached({ timeout: 10_000 });
    } finally {
      await app.close();
    }
  });

  test('extension does not crash when panel is opened and closed', async () => {
    const errors: string[] = [];
    const { app, window } = await launchVSCode();
    try {
      window.on('pageerror', (err) => {
        if (/claude/i.test(err.message)) errors.push(err.message);
      });

      await runCommand(window, 'Claude Code: Open in New Tab');
      await window.waitForTimeout(1_500);
      // Close the active editor
      await window.keyboard.press('Meta+w');
      await window.waitForTimeout(1_500);

      expect(errors).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
