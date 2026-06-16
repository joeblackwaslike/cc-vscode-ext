# Auth Flow Fix + Extensible E2E Suite — Design

**Date:** 2026-06-11
**Status:** Approved (design phase)
**Branch:** `fix/e2e-fork-bomb-safety-rails` (or a new branch off `main`)

## Problem

A fresh install of the extension into VS Code Insiders is broken in three
distinct, verified ways, and none of it was caught automatically — the user had
to manually install and report each symptom. The deeper problem is the missing
feedback loop: there is no automated check that exercises what actually ships.

### Confirmed root causes (evidence-backed)

| # | Symptom | Root cause | Evidence |
|---|---------|-----------|----------|
| 1 | "no button, just a link" on the sign-in screen | `loginUrl` is always `undefined`, so the primary **Sign In** button never renders; only the secondary **Authenticate with CLI** button shows | `WelcomeScreen.tsx:17` gates the button on `loginUrl`; `loginUrl` only comes from `AuthManager.setAuthState`, which has **zero callers** |
| 2 | Clicking "Authenticate with CLI" does nothing; log shows "unhandled message type: login" | The button posts `{type:'login'}`, but `MessageBroker` has **no `case 'login'`** and falls through to the default logger | `MessageBroker.ts:231`; `LoginMessage` is a *declared* type (`ipc.ts:162`) that was never implemented |
| 3 | Always shows "Sign in" even when the CLI is logged in | Auth state is never queried — `AuthManager` is dead code; `authenticated` starts optimistically `true` (`extensionStore.ts:20`), then the `get_auth_status` handler replies `false` because nothing ever told `AuthManager` otherwise | `AuthManager.setAuthState` defined but never called; `get_auth_status` returns the default `{authenticated:false}` |

### Out of scope (tracked follow-up)

- **`localhost:4000` browser open.** This port and any `localhost` browser-open
  do **not** exist anywhere in the extension's source (verified by full-repo
  grep across ts/tsx/js/json). The only browser-open path is
  `open_url → vscode.env.openExternal`, reachable solely from the never-rendered
  Sign In button. The rogue open therefore originates in the **vendored `claude`
  binary's own OAuth flow** when it launches. Chasing it requires inspecting the
  bundled binary and is filed as a separate task, to be done after the wiring
  below is verified.

### Why the existing suite missed all of this

The E2E harness (`test/e2e/`, Playwright + CDP, with the fork-bomb safety rails)
is well-built but has two blind spots:

1. **It tests the dev path, not the shipped artifact.** Tests launch VS Code
   with `--extensionDevelopmentPath` (source), while the user installs a
   packaged `.vsix`. Divergences between source and package go undetected.
2. **It only covers the happy path.** The acceptance test assumes the panel
   lands in a conversation (`message-input` visible). The unauthenticated
   welcome/sign-in path — where all three bugs live — is never exercised.

## Goals

1. Make the sign-in screen functional: correct buttons render, the login action
   works, and auth state reflects reality.
2. Establish an **extensible** E2E suite (page-object + test pairs) that grows
   with future features — auth is the first member, not the whole point.
3. Close the dev-vs-ships gap: the suite can run against an installed `.vsix`.
4. Give a one-command install loop that matches VS Code **Insiders**.

## Non-Goals

- Fixing the vendored CLI's `localhost:4000` OAuth redirect (separate task).
- Building a full auth/OAuth implementation inside the extension — auth remains
  the CLI binary's responsibility; the extension only reflects and triggers it.
- Removing or weakening the E2E instance cap / fork-bomb safety rails
  (`MAX_CONCURRENT = 2` is load-bearing — never remove it).

---

## Part A — Fix the auth flow

### A1. Implement the `login` message handler

**Files:** `src/ipc/MessageBroker.ts`, `src/extension.ts`

- Add an `ITerminalLauncher` interface to `MessageBrokerServices` (mirrors the
  existing `IVSCodeBridge` shape):
  ```ts
  export interface ITerminalLauncher {
    openClaudeTerminal(cwd?: string): unknown; // returns vscode.Terminal
  }
  ```
  Add `terminalLauncher?: ITerminalLauncher;` to `MessageBrokerServices`.
- Add the handler in the message switch, in the `// ─── Auth ───` section:
  ```ts
  case 'login':
    this.services.terminalLauncher?.openClaudeTerminal();
    return;
  ```
- Wire `terminalLauncher` into the `new MessageBroker(...)` services object in
  `extension.ts` (`TerminalLauncher` is already constructed at
  `extension.ts:133`).

**Result:** "Authenticate with CLI" opens an integrated terminal running
`claude`, where the CLI handles its own OAuth. No more unhandled-message log.

### A2. Auth detection on activation

**Files:** new `src/auth/AuthChecker.ts`, `src/auth/AuthManager.ts` (minor),
`src/extension.ts`, `src/ipc/MessageBroker.ts` (push path)

- New `AuthChecker` with a single responsibility: determine whether the CLI is
  authenticated, **without** running an interactive login.
  - Strategy: read the CLI credential store. Primary: `~/.claude/.credentials.json`
    (or `$CLAUDE_CONFIG_DIR`); treat a present, non-expired credential as
    authenticated. Absent/expired/unreadable → unauthenticated.
  - Interface: `checkAuth(): Promise<{ authenticated: boolean; loginUrl?: string }>`.
    `loginUrl` stays `undefined` for now (auth is terminal-driven), so the
    Sign In button correctly does **not** render; the CLI button is the path.
  - HOME/config-dir is injectable so tests can point it at a temp dir.
- On activation: call `authChecker.checkAuth()`, then
  `authManager.setAuthState(result.authenticated, result.loginUrl)`.
- Proactively post `authManager.getAuthStatusResponse()` to each webview after
  it connects (so the optimistic `authenticated:true` initial state is
  corrected without the webview having to ask). The webview already handles
  `get_auth_status_response` → `AUTH_STATUS`.

**Result:** logged-in users skip the sign-in screen; logged-out users get a
sign-in screen whose one working action (Authenticate with CLI) does the right
thing.

### A3. `localhost:4000` — tracked follow-up

File a task to inspect the vendored `claude` binary's OAuth/login flow and the
port it opens. Not implemented in this change.

---

## Part B — Extensible E2E suite + dev loop

### B1. Test the shipped artifact, not just dev-path

**Files:** `test/e2e/helpers/launch.ts`, `scripts/e2e.sh` (env passthrough)

- Parameterize `launchVSCode()` via `E2E_TARGET`:
  - `dev` (default): current `--extensionDevelopmentPath` behavior — fast inner loop.
  - `vsix`: install the packaged `.vsix` into the throwaway `--extensions-dir`
    using the discovered Code binary's `--install-extension <vsix>`, then launch
    **without** `--extensionDevelopmentPath`. Exercises exactly what ships.
- The fork-bomb registry/cap, user-data-dir markers, and teardown sweeps are
  unchanged and apply identically to both modes.
- `vsix` mode requires a prior `npm run package`; the helper asserts the `.vsix`
  exists and errors with a clear message if not.

### B2. First feature test + reusable page object

**Files:** `webview-src/components/WelcomeScreen.tsx` (test ids),
new `test/e2e/helpers/welcome.ts`, new `test/e2e/auth.test.ts`

- Add stable `data-testid`s to WelcomeScreen:
  `sign-in-button`, `auth-cli-button` (the existing `welcome-screen` and
  `new-session-button` ids stay).
- `helpers/welcome.ts` — a page object exposing the welcome screen:
  `isUnauthenticated()`, `clickAuthenticateWithCli()`, `hasSignInButton()`,
  `startNewConversation()`. This is the **template** for future feature page
  objects.
- `auth.test.ts` — first feature test:
  - **Unauthenticated** (seeded empty/expired creds): sign-in screen renders;
    `auth-cli-button` present; Sign In button **absent** (no `loginUrl`);
    clicking Authenticate with CLI opens an integrated terminal (assert a
    terminal named for claude appears) — i.e. the message is handled.
  - **Authenticated** (seeded valid creds): panel reaches the conversation-capable
    state (no sign-in screen).
- **Regression guard (stretch, best-effort):** assert the extension-host log
  produced during the test contains no `unhandled message type` line. If
  reliable log capture proves flaky under CDP, behavior assertions above are the
  primary guard and this is dropped.

### B3. Deterministic auth fixture

**Files:** `test/e2e/helpers/credentials.ts`

- Helper that creates a temp config dir and writes either a valid or an
  expired/empty `.credentials.json`, then points the launched VS Code's
  environment (`CLAUDE_CONFIG_DIR` / `HOME`) at it. Cleaned up in the test's
  `finally`, alongside `closeVSCode`. No network, no real login.

### B4. One-command Insiders install loop

**Files:** new `scripts/install-insiders.sh`, `package.json` script

- `scripts/install-insiders.sh`: run `npm run package`, locate the produced
  `.vsix`, then `code-insiders --install-extension <vsix> --force`. Error
  clearly if `code-insiders` is not on PATH (with the "Install 'code-insiders'
  command in PATH" hint).
- `package.json`: `"install:insiders": "bash scripts/install-insiders.sh"`.

---

## Data flow (after fix)

```
Activation
  → AuthChecker.checkAuth() reads credential store
  → AuthManager.setAuthState(authenticated, loginUrl)
  → broker posts get_auth_status_response to each webview
  → webview AUTH_STATUS → correct WelcomeScreen state

User clicks "Authenticate with CLI"
  → webview posts {type:'login'}
  → MessageBroker case 'login' → TerminalLauncher.openClaudeTerminal()
  → integrated terminal runs `claude`; CLI handles OAuth
```

## Testing strategy

- **Unit:** `AuthChecker` (valid / expired / missing / unreadable creds);
  `MessageBroker` `login` case dispatches to `terminalLauncher`.
- **E2E (`auth.test.ts`):** unauthenticated + authenticated paths via seeded
  creds, dev-path mode by default.
- **Pre-release:** run the suite in `E2E_TARGET=vsix` mode against the packaged
  artifact.

## Risks / open questions

- **Credential store format/location.** The exact CLI credential path/format
  must be confirmed during implementation (read-only probe of
  `~/.claude/.credentials.json` and any keychain fallback on macOS). The
  `AuthChecker` isolates this so a format change is a one-file fix.
- **Extension-host log capture under CDP** may be unreliable; the
  unhandled-message regression guard is therefore best-effort, not load-bearing.
- **`vsix` install in tests** adds latency; it is opt-in via `E2E_TARGET`, not
  the default inner-loop mode.

## Success criteria

1. Fresh logged-out install: sign-in screen shows, "Authenticate with CLI" opens
   a claude terminal, no unhandled-message log.
2. Logged-in install: no sign-in screen; conversation reachable.
3. `npm run install:insiders` installs into Code Insiders in one command.
4. `auth.test.ts` passes in dev mode and in `E2E_TARGET=vsix` mode, and would
   fail against today's broken code.
