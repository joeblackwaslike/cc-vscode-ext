# Plan mode and AskUserQuestion UI

Beads: session-relay-design-7vl
Goal: match the official Claude Code VS Code extension (2.1.296) for the `AskUserQuestion` and
`ExitPlanMode` tools, feature for feature.

## Problem

Neither tool works today, and the cause is in the protocol plumbing:

1. Commit 32941ee dropped `--permission-prompt-tool stdio` from the launch args, on the theory that
   the CLI had removed the flag. A spike on 2026-10-14 showed both the pinned CLI (2.1.237) and the
   PATH CLI (2.1.278) accept it. With the exact launch args, the pinned CLI exits 0. The `code=1`
   that commit chased was most likely the stale `--resume` fixed in the next commit (5c4b204).
2. Without that flag the CLI leaves `AskUserQuestion`, `EnterPlanMode` and `ExitPlanMode` out of the
   session entirely (they are missing from `system/init.tools`). `--permission-prompts host` does not
   bring them back. Even before 32941ee the flag was only passed in `default` mode, so `ExitPlanMode`
   never existed in plan mode.
3. With the flag set, the CLI asks the host through an inbound `control_request` with
   `subtype: "can_use_tool"`. `MessageBroker` only intercepts `control_response`, so the request would be
   broadcast as a conversation event, dropped by `conversationModel.ts`, and the turn would hang.

## Protocol

Every shape below was captured from the pinned CLI and saved to
`webview-src/lib/__fixtures__/permission-protocol.json`.

Inbound request:

```json
{"type":"control_request","request_id":"…","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion",
 "display_name":"AskUserQuestion","tool_use_id":"toolu_…","requires_user_interaction":true,"input":{…},
 "permission_suggestions":[…],"description":"…"}}
```

`permission_suggestions` and `description` are optional. ExitPlanMode never has suggestions on 2.1.237.
Write has `[{type:"setMode",mode:"acceptEdits",destination:"session"}]`.

Host reply:

```json
{"type":"control_response","response":{"subtype":"success","request_id":"…","response":Decision}}
```

`Decision` is either `{behavior:"allow", updatedInput, updatedPermissions?}` or `{behavior:"deny", message}`.

AskUserQuestion:
- Input: `{questions:[{question, header, options:[{label, description?, preview?}], multiSelect?}]}`.
- Allow with `updatedInput = {...input, answers:{[question]: "Cat, Dog"}}`. A typed "Other" answer replaces the label.
- The tool result on allow reads `The user answered: "Q1"="A1", "Q2"="A2". Read the answers carefully …`.
- The tool result on deny has `is_error: true` and the deny message as its content.

ExitPlanMode:
- Input: `{plan, planFilePath}`.
- "Yes, and auto-accept" allows with `updatedPermissions` set to the request's suggestions when present.
  Otherwise it uses `[{type:"setMode", mode:"acceptEdits", destination:"session"}]`. When the mode before
  plan mode was `auto`, the label is "Yes, and use auto mode" and the mode is `auto`.
- "Yes, and manually approve edits" allows with `[{type:"setMode", mode:"default", destination:"session"}]`.
- "No, keep planning" denies with `User chose to stay in plan mode and continue planning`. When there is
  feedback the label is "Send feedback and keep planning", and the message gets a blank line plus the
  feedback appended.
- The tool result on allow starts with `User has approved your plan`. On deny it has `is_error: true`.

Mode changes show up as `{type:"system", subtype:"status", permissionMode}`.

## Design

### Host

1. `src/process/ProcessArgs.ts`: always push `--permission-prompt-tool stdio`, except in `bypassPermissions`,
   which never prompts. Keep `--permission-mode <mode>` for non-default modes.
2. New `src/process/PermissionRequests.ts`, created **once** in `src/extension.ts` and injected into
   every `MessageBroker` the same way `processManager` and `viewManager` are. There is one broker per
   webview (`makeBroker`, extension.ts:143), and only the broker that launched a channel owns its stream
   callback, so a broker-local registry would reject answers sent from another view. It owns all pending
   prompts and broadcasts through `viewManager` itself, so every view sees the same state.
   - `register(channelId, event)` normalizes the request, stores it, and broadcasts
     `{type:"permission_request", channelId, request}`. For ExitPlanMode the request carries
     `priorMode` (see the per-channel modes bullet below).
   - `respond(channelId, requestId, decision): boolean` writes the `control_response`. It removes the
     entry and broadcasts `{type:"permission_resolved", channelId, requestId, toolUseId, decision}` only if
     the write was delivered. A failed write cancels the request instead, logs it, and reports a channel
     error ("Your answer could not be sent because the Claude connection is unavailable…") so the user
     knows the answer did not reach Claude. An unknown ID (already answered or cancelled) returns false and
     is logged, so a second answer from another view is a no-op.
   - `cancelChannel(channelId)` drops the channel's prompts and broadcasts
     `{type:"permission_cancelled", channelId, requestIds, toolUseIds}`; `toolUseIds` lets the transcript
     blocks show "No answer" or "Session ended" for the matching tool calls.
   - `replayTo(view)` sends every pending prompt to a webview that registers late (a reload).
   - Per-channel modes: it records `{current, beforePlan}` per channel from the CLI's `system/status`
     events and from adopted decisions. `beforePlan` is the mode in effect when the channel last entered
     `plan`, which drives the "Yes, and use auto mode" variant.
3. `src/process/ClaudeProcessManager.ts`:
   - `writeToChannel` returns `boolean`. It returns false when stdin isn't writable, which today is
     silently dropped, and for a channel that is neither running nor launching (a no-op). Buffering while
     a launch is in flight (`beginLaunch`/`spawnClaude`/stale-resume retry) still returns true.
   - New `onChannelExit(listener)`. It fires from the existing close and error handlers for the current
     process of a channel, and is skipped during a relay swap. The shared coordinator subscribes and
     calls `cancelChannel`.
   - Clear `resultReceived` for the channel in `sendUserMessage`. Today it's set on the first result and
     never reset, so a crash in any later turn skips `_emitSyntheticErrorIfStuck` and the spinner runs
     forever. That bug predates this work, but a turn parked on a prompt makes it much easier to hit.
4. `src/ipc/MessageBroker.ts`:
   - Stream router: a `control_request` with `can_use_tool` goes to the coordinator and is never broadcast
     as a stream event. Any other inbound subtype is logged and left unanswered, which is what the official
     extension does. While the channel is relaying, the coordinator denies the request at once with
     "Tools are unavailable during session handoff" instead of prompting, because relay turns are hidden
     from the webview.
   - `interrupt_claude` and `close_channel` call `cancelChannel` before their existing work.
   - New `permission_response` case `{channelId, requestId, decision}` calls `coordinator.respond`. On a
     delivered decision with a `setMode` and `destination:"session"`, it calls a new
     `adoptPermissionMode(mode)`. That runs the existing update steps from `set_permission_mode`
     (`currentPermissionMode`, `viewManager.setPermissionMode`, `broadcastSessionStates`,
     `sessionRelayManager.updateLaunchOptions`). It does **not** apply `getExitPlanModeFallback` and does
     not send a control request back, because the CLI already applied the mode. A `system` event carrying
     `permissionMode` is adopted the same way.
5. `src/types/ipc.ts`: add `PermissionRequest`, `PermissionDecision`, `PermissionRequestMessage`,
   `PermissionResolvedMessage`, `PermissionCancelledMessage` and `PermissionResponseMessage`. Delete the unused
   `ToolPermissionRequestMessage`. Mirror the new types on the webview side.

### Webview

6. `sessionStore` adds per-channel state:
   - `pendingPermissions: PermissionRequest[]`
   - `answers: Record<toolUseId, Record<question, string>>`
   - `planComments: Record<toolUseId, PlanComment[]>`
   - `resolvedDecisions: Record<toolUseId, "allowed" | "denied" | "cancelled">`

   Actions: `PERMISSION_ADDED`, `PERMISSION_RESOLVED`, `PERMISSIONS_CANCELLED`, `COMMENT_ADDED`, `COMMENT_REMOVED`.
7. `webview-src/lib/permissions.ts` holds the pure helpers:
   - `buildAskAnswerDecision`
   - `buildExitPlanDecision(choice, request, priorMode, feedback)`
   - `formatPlanFeedback(comments, text)`
   - `parseAskAnswers(toolResultText)`
   - `deriveAskStatus` and `deriveExitPlanStatus`
8. `webview-src/components/permissions/`:
   - `PermissionDock.tsx` sits above `ChatInput` in `ConversationView` and shows the oldest pending request
     for the active channel. It routes AskUserQuestion to `AskUserQuestionForm`, ExitPlanMode to
     `PlanApproval`, and everything else to `GenericPermission`. Send is disabled while anything is pending.
     Esc declines or denies.
   - `AskUserQuestionForm.tsx` has:
     - one tab per question, labeled with `header`, with answered and active states, plus fold and close buttons
       (close declines with "User declined to answer questions");
     - radio buttons for single select and checkboxes for multiSelect, with label and description;
     - a trailing "Other" option with a `Type your answer…` input;
     - a preview pane for single-select questions whose options have `preview` (markdown via `renderMarkdown`);
     - a 300 ms confirming flash and auto-advance after a single-select pick when there is no preview;
     - ↑/↓ for options, ←/→ for tabs, 1 to 9 to pick, Enter to submit, and a "Submit answers" button.
   - `PlanApproval.tsx` shows the header "Accept this plan?", which becomes "Continue planning" once comments
     exist. The description is "Select text in the preview to add comments", or "N comment(s) will be included
     as feedback". Then come the comment list (quote truncated to 80 chars with "…", × to remove), the three
     choices with 1/2/3 shortcuts, and a feedback input.
   - `GenericPermission.tsx` shows the tool name, `description` and primary argument, with Allow once and Deny.
     It has no persistent rules.
9. Transcript blocks, routed by tool name in `AssistantTurn.renderBlock`:
   - `AskUserQuestionBlock.tsx`: "Question" or "Questions", then `status · N question(s)` and a chevron.
     Status is answered, "No answer", "Declined" or "Session ended". Expanded, every option is shown.
     Selected ones are checked, the rest are dimmed once anything is selected, and a typed Other answer
     appears. Answers come from the store, or from `parseAskAnswers` on replayed history.
   - `ExitPlanModeBlock.tsx`: the header is "Claude's Plan" with a file-name link that opens through the existing
     `open_file` IPC, or just "Claude's Plan", or "Plan Mode". The body renders the plan as markdown. Selecting
     text inside it shows an "Add comment" popover that dispatches `COMMENT_ADDED`. The result line reads
     "User approved the plan" or "Stayed in plan mode".
10. `styles.css`: use VS Code theme variables and the green `#3fb950` accent.

`EnterPlanMode` keeps the generic tool rendering, which matches the official extension. Its permission
prompt goes through `GenericPermission`.

## Testing

- Unit tests (vitest, each one seen failing first):
  - `ProcessArgs` covers the flag in every mode except bypass.
  - `PermissionRequests` covers register, respond, unknown-ID, cancel, a failed write turning into a
    cancel, replay to a late view, and `beforePlan` tracking.
  - Two brokers sharing one coordinator: a prompt raised on broker A's channel can be answered from broker B.
  - `ClaudeProcessManager`: `writeToChannel` reports a dropped write, `onChannelExit` fires on close but not
    during a swap, and a crash in a second turn emits the synthetic error.
  - A `can_use_tool` request that arrives while relaying is denied at once.
  - Broker routing: `can_use_tool` is never broadcast as a stream event, and both `setMode` and the status
    event change the mode.
  - Store reducers.
  - `permissions.ts`, tested against the fixtures.
  - Form and approval interactions with testing-library.
- `npm run build`, typecheck and lint must be clean.
- A real round trip in the deployed extension. AskUserQuestion with two questions, one of them multiSelect
  and one answered with Other: Claude has to quote the answers back. ExitPlanMode once for each of the three
  choices: the mode picker has to flip for the two Yes choices, and the feedback has to reach Claude on No.
  Reload while a prompt is pending: the prompt has to survive. Interrupt while pending: the transcript has to
  show "Session ended".
