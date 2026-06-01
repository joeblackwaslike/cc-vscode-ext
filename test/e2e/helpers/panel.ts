import { Browser, FrameLocator, Page } from '@playwright/test';

const PALETTE_KEY = process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';

export async function openCommandPalette(window: Page): Promise<void> {
  await window.keyboard.press(PALETTE_KEY);
  const input = window.locator('.quick-input-widget .input');
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  // Small beat to ensure VS Code has focused the input before typing.
  await window.waitForTimeout(150);
}

export async function runCommand(window: Page, commandLabel: string): Promise<void> {
  await openCommandPalette(window);
  const input = window.locator('.quick-input-widget .input');
  // Prefix with '>' to enter command mode, then type the label.
  await input.fill(`>${commandLabel}`);
  // Wait for the first highlighted result row to appear.
  const firstRow = window.locator('.quick-input-widget .monaco-list-row').first();
  await firstRow.waitFor({ state: 'visible', timeout: 5_000 });
  await window.keyboard.press('Enter');
}

export async function commandExists(window: Page, query: string): Promise<boolean> {
  await openCommandPalette(window);
  await window.locator('.quick-input-widget .input').fill(`>${query}`);
  await window.waitForTimeout(500);
  const count = await window.locator('.quick-input-list .label-name').count();
  await window.keyboard.press('Escape');
  return count > 0;
}

/**
 * Wait for a vscode-webview:// page to appear in any CDP context.
 * VS Code webviews surface as separate browser contexts when connected via CDP.
 *
 * Register BEFORE issuing the command that triggers the panel open to avoid
 * missing the context-creation event.
 */
export async function waitForWebviewWindow(
  browser: Browser,
  timeoutMs = 15_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const ctx of browser.contexts()) {
      const page = ctx.pages().find((p) => p.url().startsWith('vscode-webview://'));
      if (page) {
        await page.waitForLoadState('domcontentloaded');
        return page;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No vscode-webview:// page appeared within ${timeoutMs}ms`);
}

/**
 * Returns a FrameLocator pointing at the React content inside the VS Code webview.
 * VS Code nests content two levels deep: iframe.webview.ready → iframe#active-frame.
 */
export function getWebviewFrame(window: Page): FrameLocator {
  return window.frameLocator('iframe.webview.ready').frameLocator('iframe#active-frame');
}
