import { FrameLocator, Page } from '@playwright/test';

export async function openCommandPalette(window: Page): Promise<void> {
  await window.keyboard.press('Meta+Shift+P');
  await window.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
}

export async function runCommand(window: Page, commandTitle: string): Promise<void> {
  await openCommandPalette(window);
  await window.locator('.quick-input-widget input').fill(commandTitle);
  await window.locator('.quick-input-list').locator(`text="${commandTitle}"`).first().click();
}

export async function commandExists(window: Page, query: string): Promise<boolean> {
  await openCommandPalette(window);
  await window.locator('.quick-input-widget input').fill(query);
  await window.waitForTimeout(500);
  const count = await window.locator('.quick-input-list .label-name').count();
  await window.keyboard.press('Escape');
  return count > 0;
}

export function getWebviewFrame(window: Page): FrameLocator {
  return window.frameLocator('iframe.webview.ready').first();
}
