# Plan Mode and AskUserQuestion UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AskUserQuestion` and `ExitPlanMode` work in the extension, with the official extension's UI.

**Architecture:** The CLI asks the host for tool permission over stdio (`can_use_tool` control requests). One shared
`PermissionRequests` coordinator owns pending prompts across every webview's broker, answers the CLI, and broadcasts
prompt state. The webview keeps prompt state in `sessionStore`, shows the active prompt in a dock above the composer,
and renders the two tools as custom transcript blocks.

**Tech Stack:** TypeScript, VS Code extension API, React 18, the existing test runner (host config and webview config), Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-14-plan-mode-ask-user-ui-design.md`. The protocol fixtures are in `webview-src/lib/__fixtures__/permission-protocol.json`.

## Global Constraints

- Work only in the worktree `.worktrees/plan-mode-ask-user-ui` on branch `feat/plan-mode-ask-user-ui`. Beads issue: session-relay-design-7vl.
- Run tests only through the npm scripts. A hook blocks any shell command containing the runner's name.
  - Host tests: `npm run test:unit -- <file>`. They live in `test/unit/**`.
  - Webview tests: `npm run test:webview -- <file>`. They sit next to the source as `*.test.ts(x)`.
- Before each commit, `npm run typecheck`, `npm run typecheck:webview` and `npm run lint` must be clean.
- Every test is seen failing before its implementation is written.
- Pin these exact strings:
  - `User declined to answer questions`
  - `User chose to stay in plan mode and continue planning`
  - `Tools are unavailable during session handoff`
  - `Type your answer…`
  - `Accept this plan?`, `Continue planning`, `Select text in the preview to add comments`
  - `Yes, and auto-accept`, `Yes, and use auto mode`, `Yes, and manually approve edits`
  - `No, keep planning`, `Send feedback and keep planning`
  - `User approved the plan`, `Stayed in plan mode`
  - `Submit answers`, `No answer`, `Declined`, `Session ended`, `User denied permission`
- Accent color `#3fb950`. Use VS Code theme variables for everything else.
- No new runtime dependencies.

## Review Focus

1. **Two views open** (sidebar plus panel). An answer from either view clears the card in both, and the second answer is a no-op. Pinned in Task 4 (two brokers) and Task 6 (the resolved message removes pending).
2. **The CLI dies while a prompt is pending.** The card clears and the spinner stops. Pinned in Task 2 (synthetic error on the second turn, exit listener) and Task 4 (exit cancels).
3. **An answer that contains commas or quotes.** For example, the multiSelect answer `Cat, Dog`, or a question containing `"`. The transcript shows the right selections. Pinned in Task 5 (parser cases) and Task 9 (store answers take priority over the parser).
4. **"Other" picked but left empty.** That question doesn't count as answered, and Submit stays disabled until every question has an answer. Pinned in Task 7.
5. **ExitPlanMode with no `plan` and no `planFilePath`.** The header reads `Plan Mode`, there's no body, and approval still works. Pinned in Task 9.

---

### Task 1: Restore `--permission-prompt-tool stdio`

**Files:**
- Modify: `src/process/ProcessArgs.ts` (the `permissionMode` branch in `buildArgs`)
- Test: `test/unit/process/ProcessArgs.test.ts` (the three permission tests, lines 13-31)

**Interfaces:**
- Produces: `buildArgs` emits `--permission-prompt-tool stdio` for every mode except `bypassPermissions`, plus `--permission-mode <mode>` for every non-default mode.

- [ ] **Step 1: Rewrite the permission tests.**
  - `it('passes --permission-prompt-tool stdio in every mode except bypassPermissions')`: for each of `undefined`, `'default'`, `'plan'`, `'auto'` and `'acceptEdits'`, `args.indexOf('--permission-prompt-tool')` is ≥ 0 and the next arg is `'stdio'`.
  - `it('omits --permission-prompt-tool in bypassPermissions')`.
  - Keep `passes --permission-mode for non-default modes` and `does not add --permission-mode for default mode`, but drop their assertions about the prompt-tool flag.
- [ ] **Step 2:** Run `npm run test:unit -- test/unit/process/ProcessArgs.test.ts`. Expected: the new prompt-tool test FAILS.
- [ ] **Step 3:** In `buildArgs`, push `'--permission-prompt-tool', 'stdio'` unless `options.permissionMode === 'bypassPermissions'`. Leave the `--permission-mode` push as it is.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `fix: restore --permission-prompt-tool stdio so interactive tools exist`.

### Task 2: Process manager reports delivery and exit, and resets per turn

**Files:**
- Modify: `src/process/ClaudeProcessManager.ts` (`writeToChannel` at about line 311, `sendUserMessage` at about line 340, the close and error handlers at about lines 290-304, `_cleanupIfCurrent`)
- Modify: `src/ipc/MessageBroker.ts:32` (in `IClaudeProcessManager`, `writeToChannel` now returns `boolean`)
- Test: `test/unit/process/ClaudeProcessManager.test.ts` (reuse `makeManager`, `triggerProcessEvent` and `triggerStdoutData`)

**Interfaces:**
- Produces:
  - `writeToChannel(channelId: string, data: unknown): boolean`. It returns false when stdin is null or not writable, and true when it wrote or buffered.
  - `onChannelExit(listener: (channelId: string) => void): () => void`. The return value unsubscribes.

- [ ] **Step 1: Write the failing tests.**
  - `writeToChannel returns false when stdin is not writable`: set `mockProcess.stdin.writable = false`, and the call returns `false`.
  - `onChannelExit fires once when the current process closes`.
  - `onChannelExit does not fire for a process replaced by swapChannel`.
  - `emits a synthetic error when the process dies mid-way through a second turn`. Feed a `result` line, call `sendUserMessage`, then trigger `close` with code 1. The router receives `{type:'error'}`.
- [ ] **Step 2:** Run `npm run test:unit -- test/unit/process/ClaudeProcessManager.test.ts`. Expected: the 4 new tests FAIL.
- [ ] **Step 3: Implement.**
  - Keep the exit listeners in a `Set`. Call them from the close and error handlers right after `_emitSyntheticErrorIfStuck`, guarded by the same "current process and not swapping" checks that `_cleanupIfCurrent` uses.
  - `sendUserMessage` calls `this.resultReceived.delete(channelId)` before writing.
- [ ] **Step 4:** Run it again. Expected: all PASS. Run the full `npm run test:unit` to catch broker fakes whose `writeToChannel` needs `return true`.
- [ ] **Step 5:** Commit: `fix: report dropped writes, expose channel exit, reset result flag per turn`.

### Task 3: IPC types and the shared `PermissionRequests` coordinator

**Files:**
- Modify: `src/types/ipc.ts`. Add the types below and delete `ToolPermissionRequestMessage` (line 302) along with its union entry.
- Create: `src/process/PermissionRequests.ts`
- Test: `test/unit/process/PermissionRequests.test.ts`

**Interfaces:**
- Produces, in `src/types/ipc.ts`:
  ```ts
  export interface PermissionUpdate { type: string; mode?: PermissionMode; destination?: string; [key: string]: unknown }
  export type PermissionDecision =
    | { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
    | { behavior: 'deny'; message: string };
  export interface PermissionRequest {
    channelId: string; requestId: string; toolName: string; toolUseId: string | undefined;
    input: Record<string, unknown>; suggestions: PermissionUpdate[] | undefined;
    description: string | undefined; priorMode: PermissionMode | undefined;
  }
  // ToWebviewMessage members
  export interface PermissionRequestMessage { type: 'permission_request'; request: PermissionRequest }
  export interface PermissionResolvedMessage { type: 'permission_resolved'; channelId: string; requestId: string; toolUseId: string | undefined; decision: PermissionDecision }
  export interface PermissionCancelledMessage { type: 'permission_cancelled'; channelId: string; requestIds: string[]; toolUseIds: string[] }
  // FromWebviewMessage member
  export interface PermissionResponseMessage { type: 'permission_response'; channelId: string; requestId: string; decision: PermissionDecision }
  ```
- Produces, in `src/process/PermissionRequests.ts`:
  ```ts
  export interface CanUseToolEvent { type: 'control_request'; request_id: string;
    request: { subtype: 'can_use_tool'; tool_name: string; input?: Record<string, unknown>; tool_use_id?: string;
               permission_suggestions?: PermissionUpdate[]; description?: string } }
  export function isCanUseToolRequest(event: unknown): event is CanUseToolEvent;
  export class PermissionRequests {
    constructor(deps: { write(channelId: string, data: unknown): boolean; broadcast(msg: ToWebviewMessage): void });
    register(channelId: string, event: CanUseToolEvent): PermissionRequest;    // stores and broadcasts permission_request
    respond(channelId: string, requestId: string, decision: PermissionDecision): boolean;
    denyWithoutPrompt(channelId: string, event: CanUseToolEvent, message: string): void;
    cancelChannel(channelId: string): void;                                     // broadcasts permission_cancelled if anything was dropped
    pendingFor(channelId: string): PermissionRequest[];
    noteMode(channelId: string, mode: PermissionMode): void;
  }
  ```
  `priorMode` is set only when `tool_name === 'ExitPlanMode'`. Its value is the channel's `beforePlan`: the `current` mode recorded just before `noteMode` last moved the channel into `'plan'`.
  The wire reply is `{type:'control_response', response:{subtype:'success', request_id, response: decision}}`.

- [ ] **Step 1: Write the failing tests.** Use the fixture `askControlRequest` and `exitPlanControlRequest` events, a fake `write` that returns a configurable boolean, and a `broadcast` spy.
  - `register broadcasts a normalized permission_request`: check `toolName`, `toolUseId`, and `input.questions` length 2.
  - `respond writes the control_response shape and broadcasts permission_resolved`.
  - `respond returns false for an unknown or already-answered request`.
  - `respond cancels instead of resolving when the write is dropped`.
  - `cancelChannel drops only that channel and broadcasts requestIds and toolUseIds`.
  - `pendingFor returns only that channel's unanswered requests`.
  - `ExitPlanMode requests carry the mode in effect before plan`: `noteMode('c','auto')`, then `noteMode('c','plan')`, then register gives `priorMode === 'auto'`.
  - `denyWithoutPrompt writes a deny without broadcasting`.
  - `isCanUseToolRequest rejects control_response and other subtypes`.
- [ ] **Step 2:** Run `npm run test:unit -- test/unit/process/PermissionRequests.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the class. Pending entries go in a `Map<requestId, PermissionRequest>`, and modes in a `Map<channelId, {current, beforePlan}>`.
- [ ] **Step 4:** Run it again, plus `npm run typecheck` and `npm run typecheck:webview`. Expected: PASS and clean.
- [ ] **Step 5:** Commit: `feat: shared coordinator for CLI permission prompts`.

### Task 4: Wire the coordinator into the brokers

**Files:**
- Modify: `src/ipc/MessageBroker.ts`
  - Add `permissionRequests?: PermissionRequests` to `MessageBrokerServices`. Fall back to a broker-local instance, the same pattern `sessionRelayManager` uses.
  - Stream router at line 508.
  - Cases `interrupt_claude`, `close_channel`, `get_auth_status` and the new `permission_response`.
  - Extract `adoptPermissionMode` from `set_permission_mode` (lines 240-252).
  - At launch, call `noteMode(channelId, options.permissionMode ?? 'default')`.
- Modify: `src/extension.ts` around line 143. Construct one `PermissionRequests` with `write: (c, d) => processManager.writeToChannel(c, d)` and `broadcast: (m) => viewManager.broadcastMessage(m)`. Pass it to every `makeBroker`, and subscribe `processManager.onChannelExit((id) => permissionRequests.cancelChannel(id))`.
- Test: `test/unit/ipc/MessageBroker.test.ts`. Extend the `makeBrokerWithServices` and `makeBrokerWithRelay` helpers.

**Interfaces:**
- Consumes: Task 3's `PermissionRequests`, `isCanUseToolRequest` and the message types. Task 2's `writeToChannel` boolean return.
- Produces: `private adoptPermissionMode(channelId: string, mode: PermissionMode): void`. It updates `currentPermissionMode`, calls `viewManager.setPermissionMode`, `broadcastSessionStates`, `sessionRelayManager.updateLaunchOptions(channelId, { permissionMode })` and `permissionRequests.noteMode`. It does NOT call `getExitPlanModeFallback` and does NOT send a control request.

- [ ] **Step 1: Write the failing tests.**
  - `can_use_tool control_request is registered and never broadcast as a request event`.
  - `a can_use_tool request during relay is denied with "Tools are unavailable during session handoff"`.
  - `a prompt raised on broker A's channel can be answered from broker B`: two brokers, one shared coordinator, and the response must reach `writeToChannel` for A's channel.
  - `permission_response with setMode default adopts default without the exit-plan fallback`: configure the fallback to return `'auto'`, and assert `viewManager.setPermissionMode` was called with `'default'`.
  - `a system event carrying permissionMode is adopted`: use the fixture `statusEvent`.
  - `interrupt_claude cancels the channel's pending prompts`.
  - `get_auth_status replays pending prompts to the requesting webview`.
- [ ] **Step 2:** Run `npm run test:unit -- test/unit/ipc/MessageBroker.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Router order: `control_response`, then `isCanUseToolRequest` (relaying → `denyWithoutPrompt`, otherwise `register`; return either way), then any other `control_request` (log and return), then the existing broadcast.
  - `set_permission_mode` keeps its fallback logic and calls `adoptPermissionMode` for the update steps.
- [ ] **Step 4:** Run the full `npm run test:unit`, `npm run typecheck` and `npm run lint`. Expected: all clean.
- [ ] **Step 5:** Commit: `feat: route CLI permission prompts through the shared coordinator`.

### Task 5: Webview permission helpers

**Files:**
- Create: `webview-src/lib/permissions.ts`
- Test: `webview-src/lib/permissions.test.ts`

**Interfaces:**
- Consumes: `PermissionRequest`, `PermissionDecision` and `PermissionMode` via `webview-src/lib/ipc.ts`. Add those re-exports there. Also `ToolResult` from `conversationModel.ts`.
- Produces:
  ```ts
  export const OTHER_LABEL = 'Other';
  export const ASK_DECLINE_MESSAGE = 'User declined to answer questions';
  export const KEEP_PLANNING_MESSAGE = 'User chose to stay in plan mode and continue planning';
  export interface AskOption { label: string; description?: string; preview?: string }
  export interface AskQuestion { question: string; header: string; options: AskOption[]; multiSelect: boolean }
  export interface QuestionSelection { selected: string[]; otherText: string }   // selected may include OTHER_LABEL
  export interface PlanComment { id: string; quote: string; text: string }
  export type ExitPlanChoice = 'auto' | 'manual' | 'keep-planning';
  export type AskStatus = 'pending' | 'answered' | 'declined' | 'no-answer' | 'session-ended';
  export type ExitPlanStatus = 'pending' | 'approved' | 'stayed' | 'session-ended';
  export function readAskQuestions(input: Record<string, unknown>): AskQuestion[];
  export function isQuestionAnswered(sel: QuestionSelection | undefined): boolean;
  export function buildAskAnswers(questions: AskQuestion[], selections: Record<string, QuestionSelection>): Record<string, string>;
  export function buildAskAnswerDecision(input: Record<string, unknown>, answers: Record<string, string>): PermissionDecision;
  export function exitPlanAutoLabel(priorMode: PermissionMode | undefined): string;
  export function buildExitPlanDecision(choice: ExitPlanChoice, request: PermissionRequest, feedback: string): PermissionDecision;
  export function formatPlanFeedback(comments: PlanComment[], text: string): string;
  export function parseAskAnswers(toolResultText: string, questions: AskQuestion[]): Record<string, string>;
  export function deriveAskStatus(a: { result?: ToolResult; pending: boolean; running: boolean }): AskStatus;
  export function deriveExitPlanStatus(a: { result?: ToolResult; pending: boolean; running: boolean }): ExitPlanStatus;
  ```
  Rules from the spec:
  - Labels in an answer are joined with `", "`, and `OTHER_LABEL` is replaced by `otherText`.
  - Auto choice: `updatedPermissions` is the request's suggestions when non-empty. Otherwise it's `[{type:'setMode', mode: priorMode === 'auto' ? 'auto' : 'acceptEdits', destination:'session'}]`.
  - Manual choice: `[{type:'setMode', mode:'default', destination:'session'}]`.
  - Both allow choices pass `updatedInput: request.input`.
  - Keep planning: a deny whose message is `KEEP_PLANNING_MESSAGE`, plus `"\n\n" + feedback` when the feedback isn't empty.
  - `formatPlanFeedback` gives `Comments on the plan:\n- "<quote>": <text>` with one line per comment, then a blank line and the free text. Each part is omitted when it's empty.
  - Status: a result that isn't an error means answered or approved. An error result means declined or stayed. Otherwise, pending wins, then `!running` gives session-ended, and anything else is no-answer (AskUserQuestion) or pending (ExitPlanMode).
  - `parseAskAnswers` matches each known question as `"<question>"="` and reads up to the closing `"` that is followed by `, "` + another known question, or by `. `. This keeps answers containing `", "` intact.

- [ ] **Step 1: Write the failing tests.**
  - Builders: the fixture `askControlRequest.request.input`, with selections `Red` and `[Cat, Dog]`, gives `answers` equal to `{"What is your favorite color?": "Red", "Which pets do you have?": "Cat, Dog"}`.
  - An Other selection uses the typed text.
  - `isQuestionAnswered` is false when Other is selected with whitespace-only text.
  - The three ExitPlanMode decisions, each with and without suggestions, and with `priorMode` `'auto'`.
  - `exitPlanAutoLabel` gives the two exact labels.
  - `formatPlanFeedback` formatting.
  - `parseAskAnswers` on the fixture `askToolResult.content`, plus an answer that contains `", "`.
  - Every status branch, including the fixture's denied results.
- [ ] **Step 2:** Run `npm run test:webview -- webview-src/lib/permissions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: pure helpers for permission answers and plan decisions`.

### Task 6: Session store prompt state

**Files:**
- Modify: `webview-src/store/sessionStore.ts`
- Test: `webview-src/store/sessionStore.test.ts` (the `renderHook(useSessionReducer)` pattern)

**Interfaces:**
- Consumes: the Task 3 message types and Task 5's `PlanComment`.
- Produces:
  ```ts
  export interface ChannelPermissions {
    pending: PermissionRequest[];
    answers: Record<string, Record<string, string>>;              // by toolUseId
    decisions: Record<string, 'allowed' | 'denied' | 'cancelled'>; // by toolUseId
    planComments: Record<string, PlanComment[]>;                  // by toolUseId
  }
  // SessionStoreState gains: permissions: Record<string, ChannelPermissions>
  // Actions: PERMISSION_ADDED {request} | PERMISSION_RESOLVED {channelId, requestId, toolUseId, decision}
  //   | PERMISSIONS_CANCELLED {channelId, requestIds, toolUseIds} | COMMENT_ADDED {channelId, toolUseId, comment}
  //   | COMMENT_REMOVED {channelId, toolUseId, commentId}
  export function useChannelPermissions(channelId: string): { permissions: ChannelPermissions; dispatch: React.Dispatch<Action> | undefined };
  ```
  `useChannelPermissions` reads `SessionContext` with `useContext` and returns empty state plus an `undefined` dispatch when there's no provider, so existing component tests keep working. `handleMessage` maps the three `permission_*` messages to these actions. `CLEAR_CHANNEL` also drops the channel's permissions.

- [ ] **Step 1: Write the failing tests.**
  - `PERMISSION_ADDED` dedupes on `requestId`.
  - `PERMISSION_RESOLVED` removes the pending entry, records `decisions[toolUseId]`, and copies `decision.updatedInput.answers` into `answers` when present.
  - `PERMISSIONS_CANCELLED` marks the decisions `cancelled`.
  - The comment add and remove actions.
  - `handleMessage` routes `permission_request`.
- [ ] **Step 2:** Run `npm run test:webview -- webview-src/store/sessionStore.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: track permission prompts and plan comments in the session store`.

### Task 7: `AskUserQuestionForm`

**Files:**
- Create: `webview-src/components/permissions/AskUserQuestionForm.tsx`
- Test: `webview-src/components/permissions/AskUserQuestionForm.test.tsx`

**Interfaces:**
- Consumes: Task 5's `readAskQuestions`, `isQuestionAnswered`, `buildAskAnswers`, `buildAskAnswerDecision`, `ASK_DECLINE_MESSAGE` and `OTHER_LABEL`.
- Produces: `export function AskUserQuestionForm(props: { request: PermissionRequest; onDecision: (d: PermissionDecision) => void }): JSX.Element`.
  - Roles: tabs use `role="tab"` with the `aria-selected` attribute. Options use `role="radio"` or `role="checkbox"` with `aria-checked`.
  - The Other input has the placeholder `Type your answer…`.
  - The Submit button reads `Submit answers`. The close button has `aria-label="Decline"`. The fold button has `aria-label="Fold"`.

- [ ] **Step 1: Write the failing tests.** Use the fixture request.
  - It renders one tab per `header`.
  - Clicking `Red` advances to the second tab after 300 ms (fake timers).
  - Multi-select toggles checkboxes and does not auto-advance.
  - ArrowDown moves focus between options, ArrowRight switches tabs, and `2` picks the second option.
  - With Other selected and empty text, `Submit answers` is disabled.
  - Submit calls `onDecision` with the `answers` built in Task 5.
  - Decline calls `onDecision({behavior:'deny', message: ASK_DECLINE_MESSAGE})`.
  - A single-select question whose options have `preview` shows a preview pane for the focused option and does not auto-advance.
- [ ] **Step 2:** Run `npm run test:webview -- webview-src/components/permissions/AskUserQuestionForm.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. Previews render through `renderMarkdown` into a `dangerouslySetInnerHTML` pane, the way `MarkdownText` does.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: AskUserQuestion form`.

### Task 8: Plan approval, generic card, and dock

**Files:**
- Create: `webview-src/components/permissions/PlanApproval.tsx`, `GenericPermission.tsx`, `PermissionDock.tsx`
- Modify: `webview-src/components/ConversationView.tsx`. Render `<PermissionDock channelId>` between `MessageList` and `ChatInput`, and pass `disabled={pending.length > 0}` to `ChatInput`.
- Test: `webview-src/components/permissions/PlanApproval.test.tsx`, `PermissionDock.test.tsx`

**Interfaces:**
- Consumes: Task 5's `buildExitPlanDecision`, `exitPlanAutoLabel`, `formatPlanFeedback` and `PlanComment`. Task 6's `useChannelPermissions`. Task 7's `AskUserQuestionForm`. `getToolRenderer(name).primaryArg(input)` from `webview-src/lib/toolRegistry.ts`.
- Produces:
  - `PlanApproval(props: { request: PermissionRequest; comments: PlanComment[]; onRemoveComment: (id: string) => void; onDecision: (d: PermissionDecision) => void })`
  - `GenericPermission(props: { request: PermissionRequest; onDecision: (d: PermissionDecision) => void })`. Allow once gives `{behavior:'allow', updatedInput: request.input}`. Deny gives `{behavior:'deny', message:'User denied permission'}`.
  - `PermissionDock(props: { channelId: string })`. It routes on `toolName` for `pending[0]`, and its `onDecision` posts `{type:'permission_response', channelId, requestId, decision}`. Esc denies: AskUserQuestion declines, ExitPlanMode keeps planning, and any other tool is denied.

- [ ] **Step 1: Write the failing tests.**
  - PlanApproval:
    - It shows `Accept this plan?` with no comments, and `Continue planning` plus `1 comment will be included as feedback` with one comment.
    - A quote over 80 chars is truncated with `…`.
    - Keys `1`, `2` and `3` choose auto, manual and keep-planning.
    - The first button reads `Yes, and use auto mode` when `priorMode` is `'auto'`.
    - The third button reads `Send feedback and keep planning` once feedback text is typed.
  - Dock:
    - With no provider, it renders nothing.
    - With a pending ExitPlanMode it renders PlanApproval. Choosing an option posts `permission_response` (mock `postMessage` from `webview-src/lib/ipc.ts`).
    - An unknown tool renders the generic card.
- [ ] **Step 2:** Run `npm run test:webview -- webview-src/components/permissions/`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again, plus the existing `ConversationView` and `ChatInput` tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: permission dock with plan approval and generic prompts`.

### Task 9: Transcript blocks

**Files:**
- Create: `webview-src/components/AskUserQuestionBlock.tsx`, `webview-src/components/ExitPlanModeBlock.tsx`
- Modify: `webview-src/components/AssistantTurn.tsx:118`. `renderBlock` routes `block.name === 'AskUserQuestion'` and `'ExitPlanMode'` before the `ToolCall` fallback.
- Test: `webview-src/components/AskUserQuestionBlock.test.tsx`, `ExitPlanModeBlock.test.tsx`

**Interfaces:**
- Consumes: `ToolUseBlock` from `conversationModel.ts`. Task 5's `readAskQuestions`, `parseAskAnswers`, `deriveAskStatus`, `deriveExitPlanStatus` and `PlanComment`. Task 6's `useChannelPermissions`. The existing `open_file` message `{type:'open_file', filePath}`.
- Produces:
  - `AskUserQuestionBlock(props: { tool: ToolUseBlock; channelId: string; running: boolean })`
  - `ExitPlanModeBlock(props: { tool: ToolUseBlock; channelId: string; running: boolean })`
  - `pending` comes from `permissions.pending.some(r => r.toolUseId === tool.id)`.

- [ ] **Step 1: Write the failing tests.**
  - AskUserQuestionBlock:
    - The header reads `Questions` and `2 questions`.
    - The status is `Declined` for the fixture's denied result, and `Session ended` with no result, not pending, and not running.
    - Expanded, the selected options have `aria-checked="true"` and the unselected ones carry the dim class.
    - Store answers win over parsed answers when both exist.
  - ExitPlanModeBlock:
    - The header reads `Claude's Plan` plus a link `plan-creating-a-file-vast-quail.md` that posts `open_file` (fixture input).
    - It reads `Plan Mode` with an empty input and renders no body.
    - The result line reads `User approved the plan` or `Stayed in plan mode` (fixture results).
    - Selecting text inside the body and submitting the popover dispatches `COMMENT_ADDED`. Use `window.getSelection` stubbed to a range inside the body.
- [ ] **Step 2:** Run `npm run test:webview -- webview-src/components/AskUserQuestionBlock.test.tsx webview-src/components/ExitPlanModeBlock.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. The comment popover appears on `mouseup` only when the selection is non-empty and inside the body element. It has a text input and an `Add comment` button.
- [ ] **Step 4:** Run the full `npm run test:webview`. Expected: PASS, including the existing `AssistantTurn.test.tsx`.
- [ ] **Step 5:** Commit: `feat: transcript blocks for AskUserQuestion and ExitPlanMode`.

### Task 10: Styles, build, deploy, and the real round trip

**Files:**
- Modify: `webview-src/styles.css`. Add styles for the dock, tabs, radio and checkbox, preview pane, comments, popover and the dimmed options, using the `cc-` class prefix that the files above use.

- [ ] **Step 1:** Add the styles. Run `npm run build`. Expected: both bundles build with no errors.
- [ ] **Step 2:** Run `npm run test:unit`, `npm run test:webview`, both typechecks and `npm run lint`. Expected: all clean.
- [ ] **Step 3:** Commit: `style: permission dock and plan/question blocks`.
- [ ] **Step 4:** Deploy with the AGENTS.md command: `npm run build && npx @vscode/vsce package --no-dependencies && code-insiders --install-extension "$(find . -maxdepth 1 -name 'clawd-code-*.vsix' | sort -V | tail -1)"`.
- [ ] **Step 5: Real round trip.** Done by the controller, not a subagent. Record the results in the PR body.
  - AskUserQuestion with two questions, one of them multiSelect, and one answered with Other. Claude has to quote the exact answers.
  - Plan mode, with each of the three ExitPlanMode choices in a fresh session. The mode picker flips for the two Yes choices, and comments and feedback reach Claude on No.
  - Reload the webview while a prompt is pending. The prompt is still shown. If it isn't, check whether the reloaded view reattaches the channel, and file a beads issue if that's out of scope.
  - Interrupt while a prompt is pending. The card clears and the block shows `Session ended`.
