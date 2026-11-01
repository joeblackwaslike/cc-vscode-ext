# Configurable plan-approval modes

Beads: session-relay-design-q78 (Parity P0)
Roadmap: `~/.claude/plans/i-want-to-see-lexical-grove.md`, Phase 0 items 6 and 7. Checklist: `docs/parity.md`.

## Problem

When Claude finishes a plan, the approval card offers "Yes, and use auto mode" (or "Yes, and auto-accept"). Joe wants that button to land in a mode he chooses, such as `bypassPermissions`. He also wants the follow-up "set as my default" offer to be configurable.

Three things in the current code get in the way:

1. The approve button ignores `clawdCode.exitPlanModeFallback`. `exitPlanAutoLabel` and `buildExitPlanDecision` in `webview-src/lib/permissions.ts` choose `auto` when the mode before plan was `auto` and `acceptEdits` otherwise. The setting only applies when the mode picker leaves plan (`MessageBroker.ts`, case `set_permission_mode`).
2. A session cannot switch to bypass mid-session unless the CLI was launched with `--allow-dangerously-skip-permissions`. `ProcessArgs.ts` supports the flag, and `ExtensionSettings.ts` reads `allowDangerouslySkipPermissions`, but nothing passes one to the other. The official extension offers bypass only when that setting is on and passes it at session start (inferred from its `extension.js`, not tested against the CLI).
3. `ExtensionSettings.getDefaultPermissionMode()` skips `clawdCode.defaultPermissionMode` when its value is `auto`, then falls through to `claudeCode.initialPermissionMode`. Writing `auto` as the user's default therefore has no effect if the official setting holds another value. Joe has `claudeCode.initialPermissionMode: "plan"`.

## Goals

- The approve button on the plan card sends the session to the mode set in `clawdCode.exitPlanModeFallback`, and its label names that mode.
- After approval, an optional card offers to make a mode the default for new conversations. Which mode it offers is `clawdCode.offerDefaultModeAfterPlan`.
- Bypass works end to end when selected: the CLI is launched so the switch is allowed.
- Accepting the default-mode offer actually changes the default used for the next new conversation.

## Non-goals

- Changing the other two card options ("Yes, and manually approve edits", "No, keep planning").
- Rendering the plan as a Markdown document with inline comments (a separate Phase 0 item, its own spec).
- Declaring the rest of the official settings (separate spec).
- Changing how the mode picker behaves.

## Anti-goals

- Bypass must never be reached silently. The card label names the mode, and the setting description says bypass skips all permission prompts.
- Declining or ignoring the default-mode offer must change nothing.
- No change in behavior for users who set neither setting, other than the defaults below.

## Behavior

### Settings

`clawdCode.exitPlanModeFallback` (exists): enum `auto`, `default`, `acceptEdits`, `bypassPermissions`. Default `auto`. Now also drives the approve button. This changes today's default behavior, where the button goes to `acceptEdits` unless the prior mode was `auto`. The new default matches what the official extension usually does.

`clawdCode.offerDefaultModeAfterPlan` (new): enum `auto`, `default`, `acceptEdits`, `bypassPermissions`, `off`. Default `auto`. `off` hides the card. `off` is an addition beyond what Joe asked for (a value is needed for "no card").

The other plan-card choices keep their current targets. Only the approve button follows the setting.

### Approve button

- Label: `auto` gives "Yes, and use auto mode"; `acceptEdits` gives "Yes, and auto-accept"; `default` gives "Yes, and manually approve edits" (same target as option 2, so the card hides option 2 in that case); `bypassPermissions` gives "Yes, and bypass permissions".
- Decision payload: `updatedPermissions: [{type:"setMode", mode:<configured>, destination:"session"}]`. The CLI's own `permission_suggestions` no longer take precedence over the configured mode (the pinned CLI sends none for ExitPlanMode, per the 2026-10-14 spec).
- The extension host sends the configured mode to the webview with each ExitPlanMode request, by adding a field to `PermissionRequest` in `src/types/ipc.ts` (name chosen by the builder). `priorMode` stays in the type, since the host still tracks it.
- After the host sees the `setMode` update go through, `adoptPermissionMode` runs as it does today.

### Launch flag for bypass

`--allow-dangerously-skip-permissions` is passed when any of these holds: `clawdCode.allowDangerouslySkipPermissions` is true, `claudeCode.allowDangerouslySkipPermissions` is true (fallback, same priority order as other settings), or `exitPlanModeFallback`, `offerDefaultModeAfterPlan` or the resolved default permission mode is `bypassPermissions`. Selecting bypass in a setting is treated as consent for the flag.

Joe's current settings already have `claudeCode.allowDangerouslySkipPermissions: true`, `clawdCode.exitPlanModeFallback: "bypassPermissions"` and `clawdCode.offerDefaultModeAfterPlan: "bypassPermissions"`.

`ProcessArgs.ts` omits `--permission-prompt-tool stdio` when the launch mode is `bypassPermissions`, and the reason is not documented there. The flag here makes bypass reachable without launching in it, so the prompt tool stays on and `ExitPlanMode` keeps working.

Verified on 2026-11-01 against `claude` 2.1.312, launching with `--permission-mode plan --permission-prompt-tool stdio` and sending a `set_permission_mode` control request:

- With `--allow-dangerously-skip-permissions`: switching to `bypassPermissions` succeeds.
- Without it: the CLI answers `Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions` (`error_code: bypass_not_launched`).
- Switching to `auto` succeeds without the flag.

This probe used the `set_permission_mode` control request. The plan card uses a different path, `updatedPermissions` inside the permission response, so test 8 still has to cover that path.

Flag computation: computed from current settings each time a conversation is launched (`launch_claude`) and stored in the launch options, so the `--resume` retry and the session relay relaunch reuse it. A settings change takes effect on the next launched conversation, with no restart notice.

Fallback: if the configured approve mode is `bypassPermissions` but the channel was launched without the flag, the host sends `acceptEdits` instead and the card says so. This is the only rejection the host can know in advance. If the live test (test 8) shows the CLI also rejects `auto` for some accounts, handling that case is a follow-up, not part of this spec.

### Default-mode offer

- Shown after the user picks the approve option (option 1; when the configured mode is `default`, option 1 still is the approve option), and not after "Yes, and manually approve edits" or "No, keep planning". Only when `offerDefaultModeAfterPlan` is not `off` and the offered mode differs from the current resolved default.
- Text: `Set {mode} as your default mode?` with the options `Yes, set {mode} as my default` and `No, keep {current default}`. Dismissing with Escape counts as No.
- "Current default" in the text and in the "differs" check is the resolved default, including the `claudeCode.initialPermissionMode` and `~/.claude/settings.json` fallbacks.
- Yes writes the offered mode to `clawdCode.defaultPermissionMode`. The write goes to the narrowest scope that already holds a value for that key (workspace folder, then workspace), and to user (global) settings when none does, so the new value is the one that wins. It never edits `claudeCode.*` or `~/.claude/settings.json`.
- Fix for item 3: `getDefaultPermissionMode()` must honor an explicitly set `clawdCode.defaultPermissionMode`, including `auto`. Use `inspect()` and treat a user-level or workspace-level value as set; keep the fall-through to `claudeCode.initialPermissionMode` and `~/.claude/settings.json` when it is unset.
- The card appears at most once per approval.

## Test plan (each must fail before the change)

1. `buildExitPlanDecision`: for each configured mode, the approve choice yields `setMode` with that mode, ignoring `suggestions` and `priorMode`.
2. `exitPlanAutoLabel` (or its replacement): label per mode, and option 2 hidden when the configured mode is `default`.
3. `PlanApproval` component: label and keyboard shortcut `1` per mode (extend `PlanApproval.test.tsx`).
4. Extension host: `exitPlanModeFallback` value reaches the webview with the request.
5. `ProcessArgs`/launch: flag present under each trigger in "Launch flag", absent when none apply.
6. `getDefaultPermissionMode`: explicit `clawdCode` value `auto` wins over `claudeCode.initialPermissionMode: "plan"`; unset falls through as today.
7. Default-mode offer: hidden when `off`, hidden when the offered mode equals the current default, Yes writes the setting, No and Escape write nothing.
8. Live round trip against the real CLI (not a mock): approve a plan with `exitPlanModeFallback: bypassPermissions` and confirm the session reports bypass mode, then confirm a bypass-gated action runs without a prompt. Repeat for `acceptEdits`.

## Files expected to change

`package.json` (new setting, descriptions), `src/extension.ts`, `src/ipc/MessageBroker.ts`, `src/process/PermissionRequests.ts`, `src/process/ProcessArgs.ts` and its caller, `src/settings/ExtensionSettings.ts`, `src/types/ipc.ts`, `webview-src/lib/permissions.ts`, `webview-src/components/permissions/PlanApproval.tsx`, a new default-mode card component and its test, plus the matching test files.

## Left to the builder

Names of the new IPC field and card component, styling of the new card, and whether the default-mode offer lives in `PermissionDock` or in the plan card.

## Calls made without Joe

- Default of `offerDefaultModeAfterPlan` is `auto` (matches upstream).
- The `off` value.
- Selecting bypass in a setting counts as consent for the launch flag.
- Option 2 is hidden when the configured approve mode is `default`.
- Fallback to `acceptEdits` plus a notice when the CLI rejects the switch.
- The default-mode offer writes to the narrowest scope that already holds a value.
- The offer is tied to option 1 only.
