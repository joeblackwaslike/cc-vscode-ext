# Configurable plan-approval modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plan-approval button goes to a mode set in `clawdCode.exitPlanModeFallback`, an optional card offers to make a mode the default, and bypass works end to end.

**Architecture:** Settings resolution lives in `ExtensionSettings`. The extension host puts the approve mode on each `ExitPlanMode` `PermissionRequest`, so the webview renders and decides from the request alone. The host decides whether to offer a new default after it sees the approving decision, and the webview answers the offer with one message. The launch flag is set in the launch options in `MessageBroker.handleLaunchClaude`.

**Tech Stack:** TypeScript, VS Code extension API, React webview, vitest (unit in `test/unit/`, webview tests colocated), pnpm.

**Spec:** `docs/superpowers/specs/2026-11-01-plan-approval-modes-design.md`

## Global Constraints

- Settings: `clawdCode.exitPlanModeFallback` enum `auto`, `default`, `acceptEdits`, `bypassPermissions`, default `auto`. `clawdCode.offerDefaultModeAfterPlan` enum `auto`, `default`, `acceptEdits`, `bypassPermissions`, `off`, default `auto`.
- Approve labels: `auto` "Yes, and use auto mode"; `acceptEdits` "Yes, and auto-accept"; `default` "Yes, and manually approve edits" (option 2 hidden); `bypassPermissions` "Yes, and bypass permissions".
- Approve decision payload: `updatedPermissions: [{type:"setMode", mode:<approveMode>, destination:"session"}]`; CLI `permission_suggestions` and `priorMode` never override it.
- Launch flag `--allow-dangerously-skip-permissions` is passed when `clawdCode.allowDangerouslySkipPermissions` or `claudeCode.allowDangerouslySkipPermissions` is true, or the approve mode, the offer mode, or the resolved default is `bypassPermissions`.
- Bypass requested but channel launched without the flag: send `acceptEdits` and show a notice.
- Offer card text: `Set {mode} as your default mode?` with `Yes, set {mode} as my default` and `No, keep {current default}`; Escape counts as No. Shown only after option 1, only when the setting is not `off` and the offered mode differs from the resolved default.
- Writing the default: to `clawdCode.defaultPermissionMode`, in workspace settings when the workspace already holds a value, else global. Never edit `claudeCode.*` or `~/.claude/settings.json`.
- `getDefaultPermissionMode()` must honor an explicitly set `clawdCode.defaultPermissionMode`, including `auto`.
- Commits: conventional style, one per task. Work only in `.worktrees/parity-p0`. Run `pnpm test:unit`, `pnpm test:webview`, `pnpm typecheck`, `pnpm typecheck:webview`, `pnpm lint` before each commit.

## Review Focus

- Joe's real settings (`claudeCode.initialPermissionMode: "plan"`, `claudeCode.allowDangerouslySkipPermissions: true`, both clawd plan settings `bypassPermissions`): approving must land in bypass, and the offer appears exactly once per approval (the resolved default `plan` differs from `bypassPermissions`). Covered in Task 4.
- User with neither setting: approving goes to `auto`, no regression for a prior mode of `acceptEdits`. Task 3.
- `defaultPermissionMode` set explicitly to `auto` while `claudeCode.initialPermissionMode` is `plan`: `auto` wins. Task 1.
- Workspace-scoped `clawdCode.defaultPermissionMode` already set: the offer's write must land there. Task 4.
- Invalid enum value in settings.json (for example `"turbo"`): treated as the default, not passed to the CLI. Task 1.

---

### Task 1: Settings resolution and declarations

**Files:**
- Modify: `src/settings/ExtensionSettings.ts`
- Modify: `package.json` (contributes.configuration: `exitPlanModeFallback` description, new `offerDefaultModeAfterPlan`, new `allowDangerouslySkipPermissions`)
- Modify: `src/extension.ts:174-178` (replace the inline `getExitPlanModeFallback` with the new method)
- Test: `test/unit/settings/ExtensionSettings.test.ts`

**Interfaces:**
- Produces, on class `ExtensionSettings`:
  - `type ApproveMode = Exclude<PermissionMode, 'plan'>` (exported)
  - `getExitPlanApproveMode(): ApproveMode`
  - `getOfferDefaultMode(): ApproveMode | 'off'`
  - `shouldAllowBypass(): boolean`
  - `getDefaultPermissionMode(): PermissionMode` (existing, behavior changed)
  - `setDefaultPermissionMode(mode: PermissionMode): Promise<void>`

- [ ] **Step 1: Write failing tests** in `ExtensionSettings.test.ts`, with `inspect` added to the vscode mock:
  - `getDefaultPermissionMode returns auto when clawdCode.defaultPermissionMode is explicitly auto and claudeCode.initialPermissionMode is plan`
  - `getDefaultPermissionMode falls through to claudeCode.initialPermissionMode when clawdCode value is unset`
  - `getExitPlanApproveMode returns auto by default and for an invalid value`
  - `getOfferDefaultMode returns off when configured off, auto by default, auto for an invalid value`
  - `shouldAllowBypass is true for each trigger in the spec and false when none applies`
  - `setDefaultPermissionMode writes to workspace scope when a workspace value exists, else global` (assert the `update(key, value, target)` target)
- [ ] **Step 2: Run** `pnpm test:unit -- ExtensionSettings` and see them fail.
- [ ] **Step 3: Implement** the signatures above in `ExtensionSettings.ts`. Use `inspect('defaultPermissionMode')` to decide "explicitly set" (any of globalValue, workspaceValue, workspaceFolderValue defined). Validate enums against a shared list; invalid values return the documented default. In `package.json` add the two settings with enums and descriptions; the `bypassPermissions` descriptions must say it skips all permission prompts.
- [ ] **Step 4: Replace** the inline fallback in `src/extension.ts` with `settings.getExitPlanApproveMode()`; keep the picker path (`MessageBroker` `set_permission_mode`) working.
- [ ] **Step 5: Run** unit tests and `pnpm typecheck`; expect PASS.
- [ ] **Step 6: Commit** `feat: resolve plan-approval and default-mode settings`

### Task 2: Launch flag for bypass

**Files:**
- Modify: `src/ipc/MessageBroker.ts` (`handleLaunchClaude`, services interface near line 143)
- Modify: `src/extension.ts` (provide `shouldAllowBypass` to the broker)
- Modify: `src/process/PermissionRequests.ts` (add `noteBypassAllowed`)
- Test: `test/unit/ipc/MessageBroker.test.ts`, `test/unit/process/PermissionRequests.test.ts`

**Interfaces:**
- Consumes: `ExtensionSettings.shouldAllowBypass(): boolean` from Task 1.
- Produces: broker service `shouldAllowBypass?: () => boolean`; `PermissionRequests.noteBypassAllowed(channelId: string, allowed: boolean): void`; `PermissionRequests.bypassAllowed(channelId: string): boolean`.

- [ ] **Step 1: Write failing tests:**
  - `MessageBroker launch_claude passes allowDangerouslySkipPermissions to spawn options when shouldAllowBypass is true` (and absent when false)
  - `MessageBroker launch_claude keeps the prompt tool and plan mode when the flag is set` (assert args via `buildArgs` or the spawn mock)
  - `PermissionRequests.bypassAllowed reflects the last noteBypassAllowed`
- [ ] **Step 2: Run** them; expect FAIL.
- [ ] **Step 3: Implement.** In `handleLaunchClaude`, add `allowDangerouslySkipPermissions: true` to `options` when `this.services.shouldAllowBypass?.()` is true, and call `permissionRequests.noteBypassAllowed(channelId, flag)`. Relay and retry reuse the options, so nothing else changes.
- [ ] **Step 4: Run** unit tests and typecheck; expect PASS.
- [ ] **Step 5: Commit** `feat: launch the CLI with the dangerous-skip flag when bypass is selected`

### Task 3: Approve button follows the configured mode

**Files:**
- Modify: `src/types/ipc.ts:311-321` (`PermissionRequest`)
- Modify: `src/process/PermissionRequests.ts` (`register`, deps)
- Modify: `src/extension.ts` (provide `getApproveMode`)
- Modify: `webview-src/lib/permissions.ts:79-96`
- Modify: `webview-src/components/permissions/PlanApproval.tsx`
- Test: `test/unit/process/PermissionRequests.test.ts`, `webview-src/lib/permissions.test.ts`, `webview-src/components/permissions/PlanApproval.test.tsx`

**Interfaces:**
- Consumes: `ExtensionSettings.getExitPlanApproveMode()`, `PermissionRequests.bypassAllowed(channelId)` from Tasks 1 and 2.
- Produces:
  - `PermissionRequest.approveMode: PermissionMode` and `PermissionRequest.approveNotice: string | undefined` (both set for every request; only meaningful for `ExitPlanMode`)
  - `PermissionRequestsDeps.getApproveMode?: () => ApproveMode`
  - `exitPlanApproveLabel(mode: PermissionMode): string` (replaces `exitPlanAutoLabel`)
  - `buildExitPlanDecision(choice, request, feedback)` unchanged signature, new behavior.

- [ ] **Step 1: Write failing tests:**
  - `register sets approveMode from getApproveMode for ExitPlanMode`
  - `register falls back to acceptEdits with a notice when approve mode is bypassPermissions and the channel was launched without the flag`
  - `exitPlanApproveLabel returns the spec label for each mode`
  - `buildExitPlanDecision auto choice sends setMode with request.approveMode and ignores suggestions and priorMode` (table over four modes)
  - `PlanApproval hides option 2 when approveMode is default and key 1 selects the approve choice`
  - `PlanApproval shows approveNotice when present`
- [ ] **Step 2: Run** `pnpm test:unit` and `pnpm test:webview`; expect FAIL.
- [ ] **Step 3: Implement** the interfaces. `register` reads `getApproveMode`, applies the bypass fallback using `bypassAllowed`, and keeps `priorMode` populated. `buildExitPlanDecision` uses `request.approveMode` for the approve choice. Update the two call sites of `exitPlanAutoLabel`.
- [ ] **Step 4: Run** both suites, `pnpm typecheck`, `pnpm typecheck:webview`; expect PASS.
- [ ] **Step 5: Commit** `feat: plan approval button follows exitPlanModeFallback`

### Task 4: Default-mode offer card

**Files:**
- Modify: `src/types/ipc.ts` (new messages)
- Modify: `src/process/PermissionRequests.ts` (emit offer after an approving decision)
- Modify: `src/ipc/MessageBroker.ts` (handle the response, call `setDefaultPermissionMode`)
- Create: `webview-src/components/permissions/DefaultModeOffer.tsx` and `DefaultModeOffer.test.tsx`
- Modify: `webview-src/components/permissions/PermissionDock.tsx` (render the offer) and the webview store that handles `ToWebviewMessage`
- Test: `test/unit/process/PermissionRequests.test.ts`, `test/unit/ipc/MessageBroker.test.ts`

**Interfaces:**
- Consumes: `ExtensionSettings.getOfferDefaultMode()`, `getDefaultPermissionMode()`, `setDefaultPermissionMode(mode)` from Task 1; `PermissionRequest.approveMode` from Task 3.
- Produces:
  - `ToWebviewMessage`: `{ type: 'default_mode_offer'; channelId: string; mode: PermissionMode; currentDefault: PermissionMode }`
  - `FromWebviewMessage`: `{ type: 'default_mode_offer_response'; channelId: string; mode: PermissionMode; accept: boolean }`
  - `PermissionRequestsDeps.getOfferMode?: () => ApproveMode | 'off'` and `getResolvedDefault?: () => PermissionMode`
  - `DefaultModeOffer({ mode, currentDefault, onAnswer }: { mode: PermissionMode; currentDefault: PermissionMode; onAnswer: (accept: boolean) => void })`

- [ ] **Step 1: Write failing tests:**
  - `respond emits default_mode_offer after option 1 when the offer mode differs from the resolved default`
  - `respond emits no offer when the setting is off, when modes match, after option 2, and after keep-planning`
  - `broker default_mode_offer_response with accept writes the default; with accept false writes nothing`
  - `DefaultModeOffer renders the spec text, Yes and No call onAnswer, Escape calls onAnswer(false)`
  - Joe-settings case: approve mode `bypassPermissions`, offer `bypassPermissions`, resolved default `plan`, flag allowed. Expect one offer with `mode: 'bypassPermissions'`, `currentDefault: 'plan'`.
- [ ] **Step 2: Run** the suites; expect FAIL.
- [ ] **Step 3: Implement** the interfaces. Treat a decision as option 1 when `decision.behavior === 'allow'` and the first `setMode` in `updatedPermissions` has `mode === req.approveMode`. When `approveMode` is `default`, option 2 is hidden, so a `default` setMode is option 1.
- [ ] **Step 4: Run** all suites, both typechecks, lint; expect PASS.
- [ ] **Step 5: Commit** `feat: offer to make a mode the default after plan approval`

### Task 5: Live verification, docs, deploy

**Files:**
- Modify: `test/unit/process/claude-real.acceptance.test.ts` (or add a sibling file next to it, following its pattern)
- Modify: `docs/parity.md` (mark the plan-approval rows done)

- [ ] **Step 1: Write the acceptance test** that launches the real CLI with `--permission-mode plan --allow-dangerously-skip-permissions --permission-prompt-tool stdio`, answers an `ExitPlanMode` `can_use_tool` request with `buildExitPlanDecision` for approve mode `bypassPermissions`, then asserts the session reports bypass mode (use whatever the CLI emits after the update, such as a status or the next init event) and that a normally gated tool call runs without a permission request. Repeat for `acceptEdits`. Skip with a clear message when `claude` is not on PATH, like the existing acceptance test.
- [ ] **Step 2: Run** it; if the update path fails where the control-request path passed (spec test 8), stop and report the CLI's exact error.
- [ ] **Step 3: Update** `docs/parity.md` rows and the three Phase 0 items done in this plan; add the new settings to the settings table.
- [ ] **Step 4: Run** `gates/verify.sh` equivalents (the five commands in Global Constraints) and the unit, webview and acceptance suites.
- [ ] **Step 5: Commit** `test: live round trip for plan-approval modes; update parity checklist`
- [ ] **Step 6:** Run `/no-mistakes` to push and open the PR, then the deploy sequence from `AGENTS.md` after merge.
