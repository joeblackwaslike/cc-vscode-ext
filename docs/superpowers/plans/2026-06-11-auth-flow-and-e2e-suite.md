# Auth Flow Fix + Extensible E2E Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sign-in screen functional (login button works, auth state reflects the CLI), and build an extensible E2E suite that catches this class of bug against the shipped artifact.

**Architecture:** Wire the already-existing `TerminalLauncher` into the IPC broker's `login` handler; add an isolated `AuthChecker` that reads the CLI credential store on first auth query (memoized in `AuthManager`); extend the existing Playwright+CDP harness with a deterministic credentials fixture, an installed-`.vsix` launch mode, and the first feature test (auth).

**Tech Stack:** TypeScript, VS Code Extension API, React webview, Vitest (unit), Playwright + Chrome DevTools Protocol (e2e).

**Spec:** [docs/superpowers/specs/2026-06-11-auth-flow-and-e2e-suite-design.md](../specs/2026-06-11-auth-flow-and-e2e-suite-design.md)

**Conventions:**
- Unit tests: `npx vitest run <path>` (or `npm run test:unit` for all).
- E2E: `npm run test:e2e` (wraps Playwright with the fork-bomb safety script).
- Typecheck: `npm run typecheck` (extension) and `npm run typecheck:webview` (webview).
- The E2E instance cap (`MAX_CONCURRENT = 2` in `test/e2e/helpers/registry.ts`) is load-bearing — never touch it.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/ipc/MessageBroker.ts` | Add `ITerminalLauncher` to services, `login` case, `ensureChecked()` on auth query | Modify |
| `src/extension.ts` | Pass `terminalLauncher` into broker; construct `AuthManager` with an `AuthChecker` | Modify |
| `src/auth/AuthManager.ts` | Own the memoized auth check; expose `ensureChecked()`; define checker types | Modify |
| `src/auth/AuthChecker.ts` | Read the CLI credential store; decide authenticated/not (isolated, replaceable) | Create |
| `webview-src/components/WelcomeScreen.tsx` | Add stable `data-testid`s to the two buttons | Modify |
| `test/helpers/ipcTestHarness.ts` | Add `terminalLauncher` + `ensureChecked` to mocks | Modify |
| `test/unit/auth/AuthChecker.test.ts` | Unit tests for credential detection | Create |
| `test/unit/auth/AuthManager.test.ts` | Add `ensureChecked` memoization tests | Modify |
| `test/unit/ipc/MessageBroker.test.ts` | Add `login` dispatch test | Modify |
| `test/e2e/helpers/credentials.ts` | Deterministic temp credential fixture | Create |
| `test/e2e/helpers/launch.ts` | Add `env` passthrough + `vsix` launch target | Modify |
| `test/e2e/helpers/welcome.ts` | Welcome-screen page object (template for future features) | Create |
| `test/e2e/auth.test.ts` | First feature test: unauthenticated + authenticated paths | Create |
| `scripts/install-insiders.sh` | One-command build + install into Code Insiders | Create |
| `package.json` | `install:insiders` script | Modify |

---

## Task 1: Wire the `login` handler to TerminalLauncher

**Files:**
- Modify: `src/ipc/MessageBroker.ts`
- Modify: `test/helpers/ipcTestHarness.ts`
- Modify: `test/unit/ipc/MessageBroker.test.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Add the `terminalLauncher` mock to the test harness**

In `test/helpers/ipcTestHarness.ts`, add a mock interface and field. After the `MockVSCodeBridge` interface, add:

```ts
export interface MockTerminalLauncher {
  openClaudeTerminal: ReturnType<typeof vi.fn>;
}
```

In `MockMessageBrokerServices` add the field:

```ts
export interface MockMessageBrokerServices extends Required<MessageBrokerServices> {
  authManager: MockAuthManager;
  worktreeManager: MockWorktreeManager;
  atMentionHandler: MockAtMentionHandler;
  fileListProvider: MockFileListProvider;
  vscode: MockVSCodeBridge;
  terminalLauncher: MockTerminalLauncher;
}
```

In `createMockServices()` add to the returned object:

```ts
    terminalLauncher: {
      openClaudeTerminal: vi.fn(),
    },
```

- [ ] **Step 2: Write the failing test**

In `test/unit/ipc/MessageBroker.test.ts`, add a new describe block (after an existing one, e.g. near the other service-backed tests):

```ts
  describe('login', () => {
    it('opens the claude terminal via terminalLauncher', () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'login' });
      expect(services.terminalLauncher.openClaudeTerminal).toHaveBeenCalledOnce();
    });
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/unit/ipc/MessageBroker.test.ts -t login`
Expected: FAIL — `openClaudeTerminal` not called (the broker logs "unhandled message type" instead). May also fail to typecheck on `services.terminalLauncher` until Step 4.

- [ ] **Step 4: Add the interface + service field + handler in MessageBroker**

In `src/ipc/MessageBroker.ts`, add the interface near the other service interfaces (after `IVSCodeBridge`):

```ts
export interface ITerminalLauncher {
  openClaudeTerminal(cwd?: string): unknown;
}
```

Add the field to `MessageBrokerServices`:

```ts
export interface MessageBrokerServices {
  authManager?: IAuthManager;
  worktreeManager?: IWorktreeManager;
  atMentionHandler?: IAtMentionHandler;
  fileListProvider?: IFileListProvider;
  vscode?: IVSCodeBridge;
  terminalLauncher?: ITerminalLauncher;
}
```

Add the handler in the `// ─── Auth ───` section of `handleMessage`, right after the `get_auth_status` case:

```ts
        case 'login':
          this.services.terminalLauncher?.openClaudeTerminal();
          return;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/unit/ipc/MessageBroker.test.ts -t login`
Expected: PASS

- [ ] **Step 6: Wire terminalLauncher into the broker in extension.ts**

In `src/extension.ts`, update the services object passed to `new MessageBroker(...)` inside `makeBroker` (currently around line 102):

```ts
      { authManager, worktreeManager, atMentionHandler, fileListProvider, vscode: vscBridge, terminalLauncher },
```

(`terminalLauncher` is already constructed later in the same function scope at `const terminalLauncher = new TerminalLauncher(...)`; the closure captures it and `makeBroker` is only invoked after activation completes, exactly as the existing `authManager` reference already relies on.)

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck && npx vitest run test/unit/ipc/MessageBroker.test.ts`
Expected: PASS

```bash
git add src/ipc/MessageBroker.ts src/extension.ts test/helpers/ipcTestHarness.ts test/unit/ipc/MessageBroker.test.ts
git commit -m "fix(auth): implement login handler — open claude terminal via TerminalLauncher"
```

---

## Task 2: AuthChecker — read the CLI credential store

**Files:**
- Modify: `src/auth/AuthManager.ts` (add shared types only)
- Create: `src/auth/AuthChecker.ts`
- Create: `test/unit/auth/AuthChecker.test.ts`

- [ ] **Step 1: Add shared checker types to AuthManager.ts**

At the top of `src/auth/AuthManager.ts` (after the existing import), add:

```ts
export interface AuthCheckResult {
  authenticated: boolean;
  loginUrl?: string;
}

export interface IAuthChecker {
  checkAuth(): Promise<AuthCheckResult>;
}
```

- [ ] **Step 2: Write the failing test**

Create `test/unit/auth/AuthChecker.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthChecker } from '../../../src/auth/AuthChecker';

describe('AuthChecker', () => {
  let dir: string;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `authchecker-${randomUUID()}`);
    await fsp.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  async function writeCreds(obj: unknown): Promise<void> {
    await fsp.writeFile(path.join(dir, '.credentials.json'), JSON.stringify(obj), 'utf8');
  }

  it('returns authenticated for a present, non-expired token', async () => {
    await writeCreds({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 } });
    const result = await new AuthChecker(dir).checkAuth();
    expect(result.authenticated).toBe(true);
  });

  it('returns unauthenticated for an expired token', async () => {
    await writeCreds({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() - 1_000 } });
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });

  it('returns unauthenticated when the credentials file is missing', async () => {
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });

  it('returns unauthenticated for unparseable credentials', async () => {
    await fsp.writeFile(path.join(dir, '.credentials.json'), 'not json', 'utf8');
    expect((await new AuthChecker(dir).checkAuth()).authenticated).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/unit/auth/AuthChecker.test.ts`
Expected: FAIL — `Cannot find module '.../AuthChecker'`.

- [ ] **Step 4: Implement AuthChecker**

Create `src/auth/AuthChecker.ts`:

```ts
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AuthCheckResult, IAuthChecker } from './AuthManager';

/**
 * Determines whether the vendored claude CLI is authenticated by reading its
 * credential store — WITHOUT triggering an interactive login. The exact path
 * and format are the one external unknown for this build; isolating them here
 * means a format change is a single-file fix.
 */
export class AuthChecker implements IAuthChecker {
  /** `configDir` overrides resolution (used by tests). */
  constructor(private readonly configDir?: string) {}

  private credentialsPath(): string {
    const dir = this.configDir
      ?? process.env.CLAUDE_CONFIG_DIR
      ?? path.join(os.homedir(), '.claude');
    return path.join(dir, '.credentials.json');
  }

  async checkAuth(): Promise<AuthCheckResult> {
    try {
      const raw = await fsp.readFile(this.credentialsPath(), 'utf8');
      const parsed = JSON.parse(raw) as {
        claudeAiOauth?: { accessToken?: string; expiresAt?: number };
      };
      const oauth = parsed.claudeAiOauth;
      if (!oauth?.accessToken) return { authenticated: false };
      if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) {
        return { authenticated: false };
      }
      return { authenticated: true };
    } catch {
      // Missing file, bad JSON, permission error → treat as logged out.
      return { authenticated: false };
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/unit/auth/AuthChecker.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/auth/AuthManager.ts src/auth/AuthChecker.ts test/unit/auth/AuthChecker.test.ts
git commit -m "feat(auth): add AuthChecker to detect CLI auth state from credential store"
```

---

## Task 3: Memoized auth check in AuthManager + broker query + activation wiring

**Files:**
- Modify: `src/auth/AuthManager.ts`
- Modify: `src/ipc/MessageBroker.ts`
- Modify: `test/helpers/ipcTestHarness.ts`
- Modify: `test/unit/auth/AuthManager.test.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Write the failing AuthManager test**

In `test/unit/auth/AuthManager.test.ts`, add at the end of the describe block:

```ts
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
```

Add `vi` to the vitest import at the top of the file:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/auth/AuthManager.test.ts -t ensureChecked`
Expected: FAIL — `ensureChecked` is not a function / constructor takes no checker.

- [ ] **Step 3: Implement ensureChecked in AuthManager**

In `src/auth/AuthManager.ts`, update the class to accept a checker and add the memoized method. Add the constructor and `checkPromise` field, and the method:

```ts
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
```

(Keep the existing `getAuthStatusResponse()` and `isAuthenticated()` methods unchanged below.)

- [ ] **Step 4: Run the AuthManager test to verify it passes**

Run: `npx vitest run test/unit/auth/AuthManager.test.ts`
Expected: PASS (existing tests + 3 new)

- [ ] **Step 5: Add ensureChecked to the broker's auth interface + handler**

In `src/ipc/MessageBroker.ts`, update `IAuthManager`:

```ts
export interface IAuthManager {
  ensureChecked(): Promise<void>;
  getAuthStatusResponse(): GetAuthStatusResponseMessage;
}
```

Update the `get_auth_status` case to run the check before responding:

```ts
        case 'get_auth_status': {
          await this.services.authManager?.ensureChecked();
          const response = this.services.authManager?.getAuthStatusResponse()
            ?? { type: 'get_auth_status_response' as const, authenticated: false };
          void this.webview.postMessage(response);
          return;
        }
```

- [ ] **Step 6: Add ensureChecked to the harness mock**

In `test/helpers/ipcTestHarness.ts`, update `MockAuthManager`:

```ts
export interface MockAuthManager extends IAuthManager {
  ensureChecked: ReturnType<typeof vi.fn>;
  getAuthStatusResponse: ReturnType<typeof vi.fn>;
}
```

And in `createMockServices()` the `authManager` mock:

```ts
    authManager: {
      ensureChecked: vi.fn(() => Promise.resolve()),
      getAuthStatusResponse: vi.fn(() => ({
        type: 'get_auth_status_response' as const,
        authenticated: false,
      })),
    },
```

- [ ] **Step 7: Wire AuthChecker into AuthManager in extension.ts**

In `src/extension.ts`, add the import near the other `src/auth` import:

```ts
import { AuthChecker } from './auth/AuthChecker';
```

Change the AuthManager construction (currently `const authManager = new AuthManager();`):

```ts
  const authManager = new AuthManager(new AuthChecker());
```

- [ ] **Step 8: Typecheck, run unit suites, commit**

Run: `npm run typecheck && npx vitest run test/unit/auth test/unit/ipc/MessageBroker.test.ts`
Expected: PASS

```bash
git add src/auth/AuthManager.ts src/ipc/MessageBroker.ts src/extension.ts test/helpers/ipcTestHarness.ts test/unit/auth/AuthManager.test.ts
git commit -m "feat(auth): query CLI auth state on first webview request (memoized)"
```

---

## Task 4: Add stable test ids to the WelcomeScreen buttons

**Files:**
- Modify: `webview-src/components/WelcomeScreen.tsx`

- [ ] **Step 1: Add data-testid to both buttons**

In `webview-src/components/WelcomeScreen.tsx`, add `data-testid="sign-in-button"` to the Sign In button and `data-testid="auth-cli-button"` to the Authenticate-with-CLI button:

```tsx
          {loginUrl && (
            <button
              data-testid="sign-in-button"
              style={styles.primaryButton}
              onClick={() => postMessage({ type: 'open_url', url: loginUrl })}
            >
              Sign In
            </button>
          )}
          <button
            data-testid="auth-cli-button"
            style={styles.secondaryButton}
            onClick={() => postMessage({ type: 'login' })}
          >
            Authenticate with CLI
          </button>
```

- [ ] **Step 2: Typecheck the webview and commit**

Run: `npm run typecheck:webview`
Expected: PASS

```bash
git add webview-src/components/WelcomeScreen.tsx
git commit -m "test(webview): add stable test ids to welcome-screen auth buttons"
```

---

## Task 5: Deterministic E2E credentials fixture

**Files:**
- Create: `test/e2e/helpers/credentials.ts`

- [ ] **Step 1: Create the fixture helper**

Create `test/e2e/helpers/credentials.ts`:

```ts
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface CredentialsFixture {
  /** Point the launched VS Code at this via the CLAUDE_CONFIG_DIR env var. */
  configDir: string;
  cleanup(): Promise<void>;
}

/**
 * Write a fake `.credentials.json` into a throwaway config dir so E2E tests can
 * deterministically exercise the authenticated and unauthenticated paths with
 * no network and no real login. Pass `configDir` to launchVSCode via
 * `{ env: { CLAUDE_CONFIG_DIR: fixture.configDir } }`.
 */
export async function seedCredentials(authenticated: boolean): Promise<CredentialsFixture> {
  const configDir = path.join(os.tmpdir(), `claw-e2e-creds-${randomUUID()}`);
  await fsp.mkdir(configDir, { recursive: true });

  const creds = authenticated
    ? {
        claudeAiOauth: {
          accessToken: 'e2e-fake-access-token',
          refreshToken: 'e2e-fake-refresh-token',
          expiresAt: Date.now() + 3_600_000,
          scopes: ['user:inference'],
        },
      }
    : {};

  await fsp.writeFile(path.join(configDir, '.credentials.json'), JSON.stringify(creds), 'utf8');

  return {
    configDir,
    async cleanup() {
      try {
        await fsp.rm(configDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/helpers/credentials.ts
git commit -m "test(e2e): add deterministic credentials fixture helper"
```

---

## Task 6: Launch helper — env passthrough + installed-.vsix target

**Files:**
- Modify: `test/e2e/helpers/launch.ts`

- [ ] **Step 1: Import spawnSync**

In `test/e2e/helpers/launch.ts`, update the `node:child_process` import:

```ts
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
```

- [ ] **Step 2: Add a vsix locator**

Add near `findVSCodeCode()`:

```ts
function findVsix(): string {
  const entries = fs
    .readdirSync(REPO_ROOT)
    .filter((e) => e.endsWith('.vsix'))
    .map((e) => path.join(REPO_ROOT, e));
  if (entries.length === 0) {
    throw new Error('No .vsix found in repo root. Run `npm run package` before E2E_TARGET=vsix.');
  }
  // Newest by mtime.
  entries.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return entries[0];
}
```

- [ ] **Step 3: Add LaunchOptions and resolve the target**

Add the options interface above `launchVSCode`:

```ts
export interface LaunchOptions {
  /** 'dev' = run from source (--extensionDevelopmentPath); 'vsix' = install the packaged artifact first. */
  target?: 'dev' | 'vsix';
  /** Extra env vars merged into the spawned VS Code process (e.g. CLAUDE_CONFIG_DIR). */
  env?: Record<string, string>;
}
```

Change the signature and resolve the target at the top of the function body:

```ts
export async function launchVSCode(opts: LaunchOptions = {}): Promise<LaunchResult> {
  // Fork-bomb stop: refuse to spawn if too many instances are already live.
  assertUnderCap();

  const target = opts.target ?? (process.env.E2E_TARGET as 'dev' | 'vsix' | undefined) ?? 'dev';
  const codeBin = findVSCodeCode();
  const userDataDir = path.join(os.tmpdir(), `vscode-e2e-${randomUUID()}`);
  await fsp.mkdir(path.join(userDataDir, 'extensions'), { recursive: true });

  const cdpPort = await findFreePort();
```

- [ ] **Step 4: Install the vsix when target is 'vsix'**

Immediately after the `await fsp.mkdir(...)`/`cdpPort` lines and before the `spawn(...)`, add:

```ts
  if (target === 'vsix') {
    const vsix = findVsix();
    const install = spawnSync(
      codeBin,
      ['--install-extension', vsix, '--extensions-dir', path.join(userDataDir, 'extensions')],
      { stdio: 'inherit' },
    );
    if (install.status !== 0) {
      throw new Error(`Failed to install ${vsix} (exit ${install.status ?? 'null'}).`);
    }
  }
```

- [ ] **Step 5: Make the dev flag conditional and merge env**

In the `spawn(codeBin, [ ... ])` args array, replace the unconditional `--extensionDevelopmentPath` line with a conditional spread. The args array becomes:

```ts
    [
      `--remote-debugging-port=${cdpPort}`,
      ...(target === 'dev' ? [`--extensionDevelopmentPath=${REPO_ROOT}`] : []),
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${path.join(userDataDir, 'extensions')}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      '--no-sandbox',
      '--disable-gpu',
      '--headless',
      '--remote-allow-origins=*',
      userDataDir,
    ],
```

In the spawn options object, merge `opts.env` into the env (after `ELECTRON_ENABLE_LOGGING: '0'`):

```ts
    { detached: true, env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_NO_ATTACH_CONSOLE')), ELECTRON_ENABLE_LOGGING: '0', ...opts.env } },
```

- [ ] **Step 6: Verify existing E2E still launches (dev target unchanged)**

Run: `npm run test:e2e -- panel.test.ts`
Expected: PASS (same behavior as before — default target is `dev`).

- [ ] **Step 7: Commit**

```bash
git add test/e2e/helpers/launch.ts
git commit -m "test(e2e): support env passthrough and installed-.vsix launch target"
```

---

## Task 7: Welcome page object + first feature test (auth)

**Files:**
- Create: `test/e2e/helpers/welcome.ts`
- Create: `test/e2e/auth.test.ts`

- [ ] **Step 1: Create the welcome page object**

Create `test/e2e/helpers/welcome.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing auth test**

Create `test/e2e/auth.test.ts`:

```ts
import { expect, test } from '@playwright/test';
import { closeVSCode, launchVSCode } from './helpers/launch';
import { getWebviewFrame, runCommand } from './helpers/panel';
import { WelcomePage } from './helpers/welcome';
import { seedCredentials } from './helpers/credentials';

const AUTH_TIMEOUT = 120_000;

test.describe('Auth flow', () => {
  test('unauthenticated: sign-in screen shows and CLI auth opens a terminal', async () => {
    test.setTimeout(AUTH_TIMEOUT);
    const creds = await seedCredentials(false);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;
      await runCommand(window, 'Claw Code: Open in New Tab');
      const welcome = new WelcomePage(getWebviewFrame(window));

      // The CLI auth button renders; the loginUrl-gated Sign In button does not.
      await expect(welcome.authenticateWithCliButton()).toBeVisible({ timeout: 20_000 });
      await expect(welcome.signInButton()).toHaveCount(0);

      // Clicking it is now handled: an integrated terminal opens (was a no-op).
      await welcome.authenticateWithCliButton().click();
      await expect(window.locator('.xterm').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });

  test('authenticated: no sign-in screen, conversation entry is reachable', async () => {
    test.setTimeout(AUTH_TIMEOUT);
    const creds = await seedCredentials(true);
    const result = await launchVSCode({ env: { CLAUDE_CONFIG_DIR: creds.configDir } });
    try {
      const { window } = result;
      await runCommand(window, 'Claw Code: Open in New Tab');
      const welcome = new WelcomePage(getWebviewFrame(window));

      await expect(welcome.newConversationButton()).toBeVisible({ timeout: 20_000 });
      await expect(welcome.authenticateWithCliButton()).toHaveCount(0);
    } finally {
      await closeVSCode(result);
      await creds.cleanup();
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails against current behavior**

First check out the failing baseline by stashing the Task 1–4 source fixes is NOT required — instead confirm the test is meaningful: run it now (with fixes in place) and it should PASS. To prove it *would* catch the bug, temporarily revert the `login` handler (comment out the `case 'login'` body) and re-run the unauthenticated test:

Run: `npm run test:e2e -- auth.test.ts`
Expected with handler reverted: the unauthenticated test FAILS at the `.xterm` assertion (terminal never opens). Restore the handler afterward.

- [ ] **Step 4: Run the test to verify it passes with fixes in place**

Run: `npm run test:e2e -- auth.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add test/e2e/helpers/welcome.ts test/e2e/auth.test.ts
git commit -m "test(e2e): cover unauthenticated + authenticated welcome-screen paths"
```

---

## Task 8: One-command install into VS Code Insiders

**Files:**
- Create: `scripts/install-insiders.sh`
- Modify: `package.json`

- [ ] **Step 1: Create the install script**

Create `scripts/install-insiders.sh`:

```bash
#!/usr/bin/env bash
# Build the extension into a .vsix and install it into VS Code Insiders.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v code-insiders >/dev/null 2>&1; then
  echo "error: 'code-insiders' is not on your PATH." >&2
  echo "In VS Code Insiders: Cmd+Shift+P -> \"Shell Command: Install 'code-insiders' command in PATH\"" >&2
  exit 1
fi

echo "Packaging extension..."
npm run package

vsix="$(ls -t ./*.vsix 2>/dev/null | head -n1 || true)"
if [ -z "${vsix:-}" ]; then
  echo "error: 'npm run package' produced no .vsix in the repo root." >&2
  exit 1
fi

echo "Installing ${vsix} into VS Code Insiders..."
code-insiders --install-extension "${vsix}" --force

echo "Done. Reload Insiders to pick it up: Cmd+Shift+P -> 'Developer: Reload Window'."
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/install-insiders.sh`

- [ ] **Step 3: Add the npm script**

In `package.json`, add to `"scripts"` (after `"package"`):

```json
    "install:insiders": "bash scripts/install-insiders.sh"
```

- [ ] **Step 4: Verify it runs end-to-end**

Run: `npm run install:insiders`
Expected: packages a `.vsix`, installs into Code Insiders, prints the reload hint. (If `code-insiders` is absent, it errors with the PATH-install instruction — that is correct behavior.)

- [ ] **Step 5: Commit**

```bash
git add scripts/install-insiders.sh package.json
git commit -m "chore: add install:insiders script (build + install .vsix into Code Insiders)"
```

---

## Final verification

- [ ] Run the full unit suite: `npm run test:unit` → all pass.
- [ ] Run typechecks: `npm run typecheck && npm run typecheck:webview` → clean.
- [ ] Run E2E in dev mode: `npm run test:e2e -- auth.test.ts panel.test.ts` → pass.
- [ ] Run E2E against the shipped artifact: `npm run package && E2E_TARGET=vsix npm run test:e2e -- auth.test.ts` → pass (this is the loop that would have caught the original breakage).
- [ ] Manual smoke: `npm run install:insiders`, reload Insiders, confirm: logged out → "Authenticate with CLI" opens a terminal running claude; logged in → no sign-in screen.

## Tracked follow-up (NOT in this plan)

- Investigate the `localhost:4000` browser-open in the vendored `claude` binary's OAuth flow. It is external to this extension's source; chase it in the bundled binary after the above lands.
```
