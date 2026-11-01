# Parity with the official Claude Code extension

Reference: `anthropic.claude-code` 2.1.314 (VS Code ^1.94). Sources: the installed extension's `package.json`, `extension.js` and webview bundle, the [VS Code docs page](https://code.claude.com/docs/en/vs-code), and the [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). Only `VSCode`-tagged entries from roughly the last 60 versions were read, so the changelog list may have gaps.

Status: **have** (code exists), **partial**, **missing**, **skip** (decided not to build). Phase refers to the roadmap; bead IDs are in `bd list`.

## Commands

| Official command | Status | Phase |
|---|---|---|
| `sidebar.open`, `editor.open`, `editor.openLast`, `primaryEditor.open`, `window.open`, `terminal.open` | have | |
| `newConversation`, `reopenClosedSession`, `focus`, `blur`, `toggleFocusView` | have | |
| `insertAtMention`, `createWorktree`, `update`, `logout`, `showLogs`, `openWalkthrough` | have | |
| `acceptProposedDiff`, `rejectProposedDiff` | have | |
| `installPlugin` | alias only, no handler | 5 |
| `focusLastMessage` | missing | 2 |
| `markSessionUnread`, `renameSessionTab`, `addSessionTabToGroup` | missing | 6 |
| `acceptProposedHunk`, `rejectProposedHunk`, and the `...FromBar` variants | missing | 4 |

Aliases for `claude-vscode.*` were last checked at 2.1.181. Re-check against 2.1.314.

## Settings (`claudeCode.*` upstream, `clawdCode.*` here)

| Setting | Status | Phase |
|---|---|---|
| `initialPermissionMode` (as `defaultPermissionMode`) | have | |
| `useTerminal`, `environmentVariables` | read from `claudeCode.*`, not declared | 0 |
| `enableNewConversationShortcut`, `enableReopenClosedSessionShortcut` | have | |
| `attachOpenFile`, `attachSelection`, `respectGitIgnore`, `autosave` | missing | 1 |
| `useCtrlEnterToSend`, `scrollToBottomOnSend`, `showMessageTimestamps`, `spinnerVerbs`, `hideOnboarding` | missing | 2 |
| `preferredLocation`, `lockEditorGroups`, `focusView` | missing | 0 |
| `archiveInactiveSessions`, `continueAfterReload` | missing | 6 |
| `claudeProcessWrapper`, `usePythonEnvironment`, `disableLoginPrompt` | missing | 6 |
| `allowDangerouslySkipPermissions` (launches the CLI with `--allow-dangerously-skip-permissions`) | have | |

Semantics worth copying: the open file is attached when `attachOpenFile` is on, or when `attachSelection` is on and text is selected. Alt+K still adds a selection as an @-mention when `attachSelection` is off. `initialPermissionMode` accepts `manual` as an alias for `default`, and the extension also reads `~/.claude/settings.json` (v2.1.283+).

Deliberate divergences:

- `clawdCode.attachOpenFile=false` removes the automatic open-file attachment entirely, including the file name shown in the footer.
- `clawdCode.exitPlanModeFallback` sets the mode behind the plan approval button. Upstream has no documented setting for this.
- `clawdCode.offerDefaultModeAfterPlan` picks which mode the "set as my default" card offers (any permission mode, or `off` to hide the card).
- `clawdCode.exitPlanModeFallback`, `clawdCode.offerDefaultModeAfterPlan` and `clawdCode.allowDangerouslySkipPermissions` are implemented. A live run against the real CLI (`test/unit/process/plan-approval.acceptance.test.ts`, `CLAUDE_ACCEPTANCE=1`) showed that approving ExitPlanMode with `bypassPermissions` or `acceptEdits` changes the session mode: Write and Bash ran with no further permission request under bypass, and under `acceptEdits` Write ran unprompted while Bash still asked. The CLI emits no mode event after the update, so the permission behavior is the observable.

## Keybindings

All nine upstream defaults exist here. Source of truth is `package.json`.

## IDE integration (Phase 1)

Protocol, as implemented in the official `extension.js`:

- Lock file: `~/.claude/ide/<port>.lock`, directory mode 0700, file mode 0600. Path root is presumed to be the Claude config dir (not confirmed).
- JSON fields: `pid` (the extension host's parent pid), `workspaceFolders`, `ideName`, `transport: "ws"`, `runningInWindows`, `authToken`. Rewritten when workspace folders change, deleted on dispose.
- Transport: WebSocket on `127.0.0.1`, random port in 10000 to 65535.
- Auth: the `x-claude-code-ide-authorization` header must equal `authToken` (random UUID). Mismatch closes with code 1008. Only one client is kept; a new connection replaces the old one.
- Env: `CLAUDE_CODE_SSE_PORT` on the terminal environment. Other discovery env vars not found.
- Tools: `getDiagnostics`, `openDiff`, `closeAllDiffTabs`, `getOpenEditors`, `getWorkspaceFolders`, `getCurrentSelection`, `getLatestSelection`, `checkDocumentDirty`, `saveDocument`, `openFile`, `close_tab`, `executeCode` (skip). Notifications: `at_mentioned`, `selection_changed`.
- The model sees only `getDiagnostics` (and `executeCode`). The rest serve the CLI's own IDE connection.

Status: missing.

## UI surfaces

| Feature | Status | Phase |
|---|---|---|
| Sidebar, secondary sidebar, panel and editor tabs, multi-tab | have | |
| Sessions list, resume, history, groups storage | have | |
| Permission dock, permission-mode picker, model picker, effort levels | have | |
| Plan approval card (auto, manual, keep planning, feedback); the approve button follows `clawdCode.exitPlanModeFallback` | have | |
| AskUserQuestion | have | |
| Native diff, accept and reject | have | |
| Focus view, context ring | have | |
| Image paste (clipboard), Shift-drag files, removable attachments | missing (menu item disabled) | 2 |
| Rewind menu on hover: fork, rewind code, fork and rewind | missing | 3 |
| `/mcp` dialog: add, remove by scope, enable, reconnect, OAuth | missing | 5 |
| `/plugins` dialog: Plugins and Marketplaces tabs, install scopes | missing | 5 |
| URI handler: `/open?prompt=&session=`, `/install-plugin?plugin=&marketplace=` | missing | 5 |
| Per-hunk accept and reject | missing | 4 |
| Pending and done tab icons | missing | 4 |
| API-key login via `ANTHROPIC_API_KEY`; Bedrock, Vertex, Foundry via `~/.claude/settings.json` | partial | 6 |
| Bypass mode (only offered when `allowDangerouslySkipPermissions` is on) | have | |

## Found in the changelog (approved, assigned to phases)

| Feature | Phase |
|---|---|
| Plan opens as a Markdown document with inline comments; `/plan`, `/plan <task>`, `/plan open` (2.1.280+) | 0 |
| Post-approval card "Yes, set auto mode as my default", with the offered mode configurable by `clawdCode.offerDefaultModeAfterPlan` (any permission mode, or `off`): done | 0 |
| Option previews on question cards | 2 |
| LaTeX and syntax-colored code blocks | 2 |
| Chat row for files Claude sends you | 2 |
| Bookmarks side panel; session filters | 6 |
| Idle compaction | 6 |
| Continue/Stop prompt when auto mode falls back to billed classifier requests | 6 |
| "Run in background" for commands and subagents | 6 |
| `/usage` dialog, `/btw` side questions, `/tasks` agent map | 6 |
| A user's own `/mcp`, `/config` or `/settings` command must not be shadowed by the extension's dialog | 5 |

Skip: voice dictation (Wispr Flow instead), Web tab and cloud sessions, remote control, teleport, Jupyter `executeCode`.

Approved, Phase 5: `@browser` (Claude in Chrome). A prompt mention (`@browser`, `@browser:new_tab`) that connects to the Chrome extension for that prompt, plus an optional setting to stay connected in every session. Browser tools ask for permission as in default mode; site permissions come from the Chrome extension. Unavailable on Bedrock, Vertex and Foundry.
