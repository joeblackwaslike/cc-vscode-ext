import { FrameLocator, Locator } from '@playwright/test';

/**
 * Page object for the WelcomeScreen webview. Template for future feature page
 * objects: wrap a FrameLocator, expose intent-named accessors, no assertions.
 */
export class WelcomePage {
  constructor(private readonly frame: FrameLocator) {}

  screen(): Locator {
    return this.frame.getByTestId('welcome-screen');
  }

  /** Present only when unauthenticated. */
  authenticateWithCliButton(): Locator {
    return this.frame.getByTestId('auth-cli-button');
  }

  /** Present only when a real loginUrl exists (currently never — terminal-driven). */
  signInButton(): Locator {
    return this.frame.getByTestId('sign-in-button');
  }

  /** Present only when authenticated. */
  newConversationButton(): Locator {
    return this.frame.getByTestId('new-session-button');
  }
}
