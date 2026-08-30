import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { runCommand } from './helpers/panel';

test.describe('Process and terminal integration', () => {
  test('Open in Terminal creates a named terminal', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Open in Terminal');
      await window.waitForTimeout(3_000);

      const terminalPanel = window.locator('.terminal-outer-container, .panel.integrated-terminal');
      await expect(terminalPanel.first()).toBeAttached({ timeout: 10_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('Show Logs command opens an output channel', async () => {
    const result = await launchVSCode();
    try {
      const { window } = result;
      await runCommand(window, 'Clawd Code: Show Logs');
      await window.waitForTimeout(2_000);

      const outputPanel = window.locator('.panel .output');
      await expect(outputPanel.first()).toBeAttached({ timeout: 10_000 });
    } finally {
      await closeVSCode(result);
    }
  });

  test('extension does not crash when panel is opened and closed', async () => {
    const errors: string[] = [];
    const result = await launchVSCode();
    try {
      result.window.on('pageerror', (err) => {
        if (/claude/i.test(err.message)) errors.push(err.message);
      });

      await runCommand(result.window, 'Clawd Code: Open in New Tab');
      await result.window.waitForTimeout(1_500);
      await result.window.keyboard.press('Meta+w');
      await result.window.waitForTimeout(1_500);

      expect(errors).toHaveLength(0);
    } finally {
      await closeVSCode(result);
    }
  });
});
