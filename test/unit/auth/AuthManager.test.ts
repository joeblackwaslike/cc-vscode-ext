import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthManager } from '../../../src/auth/AuthManager';

describe('AuthManager', () => {
  let manager: AuthManager;

  beforeEach(() => {
    manager = new AuthManager();
  });

  it('isAuthenticated() returns false initially', () => {
    expect(manager.isAuthenticated()).toBe(false);
  });

  it('getAuthStatusResponse() returns authenticated=false initially', () => {
    const response = manager.getAuthStatusResponse();
    expect(response.type).toBe('get_auth_status_response');
    expect(response.authenticated).toBe(false);
  });

  it('setAuthState(true) marks as authenticated', () => {
    manager.setAuthState(true);
    expect(manager.isAuthenticated()).toBe(true);
  });

  it('getAuthStatusResponse() returns authenticated=true after setAuthState(true)', () => {
    manager.setAuthState(true);
    const response = manager.getAuthStatusResponse();
    expect(response.authenticated).toBe(true);
    expect(response.loginUrl).toBeUndefined();
  });

  it('setAuthState(false, loginUrl) stores loginUrl', () => {
    manager.setAuthState(false, 'https://claude.ai/login');
    const response = manager.getAuthStatusResponse();
    expect(response.authenticated).toBe(false);
    expect(response.loginUrl).toBe('https://claude.ai/login');
  });

  it('loginUrl is cleared when authenticated', () => {
    manager.setAuthState(false, 'https://claude.ai/login');
    manager.setAuthState(true);
    expect(manager.getAuthStatusResponse().loginUrl).toBeUndefined();
  });

  it('ensureChecked() runs the checker once and applies its result', async () => {
    const checker = { checkAuth: vi.fn(async () => ({ authenticated: true })) };
    const m = new AuthManager(checker);
    await m.ensureChecked();
    await m.ensureChecked();
    expect(checker.checkAuth).toHaveBeenCalledOnce();
    expect(m.isAuthenticated()).toBe(true);
  });

  it('ensureChecked() treats a checker error as logged out', async () => {
    const checker = { checkAuth: vi.fn(async () => { throw new Error('boom'); }) };
    const m = new AuthManager(checker);
    await m.ensureChecked();
    expect(m.isAuthenticated()).toBe(false);
  });

  it('ensureChecked() is a no-op when no checker is provided', async () => {
    const m = new AuthManager();
    await expect(m.ensureChecked()).resolves.toBeUndefined();
  });
});
