import type { GetAuthStatusResponseMessage } from '../types/ipc';

export interface AuthCheckResult {
  authenticated: boolean;
  loginUrl?: string;
}

export interface IAuthChecker {
  checkAuth(): Promise<AuthCheckResult>;
}

/**
 * Manages authentication state for the claude CLI.
 *
 * Authentication is handled by the vendored `claude` binary itself (OAuth).
 * This manager tracks the last-known auth state so webviews can display it
 * without re-querying the process on every render.
 */
export class AuthManager {
  private authenticated = false;
  private loginUrl: string | undefined;
  private checkPromise: Promise<void> | undefined;

  constructor(private readonly checker?: IAuthChecker) {}

  /** Update the cached auth state (called after querying the CLI binary). */
  setAuthState(authenticated: boolean, loginUrl?: string): void {
    this.authenticated = authenticated;
    this.loginUrl = authenticated ? undefined : loginUrl;
  }

  /**
   * Run the auth check exactly once (memoized) and cache the result. Safe to
   * call on every auth query; only the first call hits the checker.
   */
  async ensureChecked(): Promise<void> {
    if (!this.checker) return;
    this.checkPromise ??= this.checker
      .checkAuth()
      .then((r) => this.setAuthState(r.authenticated, r.loginUrl))
      .catch(() => this.setAuthState(false));
    return this.checkPromise;
  }

  /** Returns the current auth state as a response message ready for the webview. */
  getAuthStatusResponse(): GetAuthStatusResponseMessage {
    return {
      type: 'get_auth_status_response',
      authenticated: this.authenticated,
      ...(this.loginUrl !== undefined ? { loginUrl: this.loginUrl } : {}),
    };
  }

  /** Returns true if the user is currently authenticated. */
  isAuthenticated(): boolean {
    return this.authenticated;
  }
}
