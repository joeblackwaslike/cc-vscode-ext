# Open-file and selection context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The composer shows removable open-file and selection chips fed by the editor, the prompt carries exactly what the chips show, and past `<ide_*>` tags render as chips.

**Architecture:** A host `EditorContextTracker` applies the three settings and the ignore rule, then broadcasts `ide_context` to every webview. The webview shows chips and sends the visible `{filePath, selection?}` on `control_request`. The host formats the tag text blocks (shared pure module `src/shared/ideTags.ts`, also used by the webview for the optimistic turn and for parsing history).

**Tech Stack:** TypeScript, VS Code API, React webview, vitest (host `--pool=forks`, webview config), real `claude` CLI for the live checks.

**Spec:** `docs/superpowers/specs/2026-11-01-open-file-and-selection-context-design.md`

## Global Constraints

- Settings live under `clawdCode.*` with `claudeCode.*` fallback when the clawd key is unset; workspace values allowed: `attachOpenFile` (default `true`), `attachSelection` (`true`), `respectGitIgnore` (`true`).
- Tag wording is exact: `<ide_selection>The user selected the lines S to E from <path>:\n<text>\n</ide_selection>`; `<ide_opened_file>The user opened the file <path> in the IDE. This may or may not be related to the current task.</ide_opened_file>`; withheld form `<ide_selection>The user selected the lines S to E from <path>. The selected text was not included because the file is git-ignored or excluded.</ide_selection>`.
- Selected text is capped at 50,000 chars; over-cap text is cut and the block ends with `[truncated N characters]`.
- Only `file`-scheme documents give context; the tracker keeps the last file editor until its document closes; updates are debounced 300 ms and posted only when changed.
- Tracker uses an injected exec fn for `git check-ignore -q <path>` (C locale, cwd = file's directory). Exit 0 = ignored; exit 1, git not installed (`ENOENT`), or exit 128 with `not a git repository` in stderr = not ignored. Anything else (timeout, kill, other spawn failure, other exit 128, other code, rejection) withholds the text and is not cached. A `workspace.findFiles` probe covers `files.exclude`; a probe that throws or runs past 5 s withholds the text and is not cached. Settled answers are cached per path until the document closes, `files.exclude` changes, or a `.gitignore` is changed, created or deleted. `search.exclude` is not evaluated.
- At send time the host re-applies `attachSelection`, `attachOpenFile` and the ignore check to the context before formatting it.
- Dismissal identity of a chip = file path + line range (a text-only change does not restore it).
- Content becomes an array of text blocks only when context exists; with none, it stays the plain string.
- Queued relay prompts and `outstandingTurns` keep the blocks captured at send time.
- No `vscode` import in `src/shared/`. No new dependencies. No ASCII banner comments; no inline comments unless unavoidable.
- Tests: host `node_modules/.bin/vitest run --config vitest.config.ts --pool=forks <file>`; webview `... --config vitest.webview.config.ts <file>`. Type checks: `node_modules/.bin/tsc --noEmit -p tsconfig.extension.json` and `-p tsconfig.webview.json`. Live tests gated by `CLAUDE_ACCEPTANCE=1`.

## Review Focus

- Path with spaces, `$`, backticks, or `</ide_selection>` inside selected text: tags must not break and the parser must not truncate the turn text (Task 1, Task 6).
- Empty selection or selection ending at column 0 of the next line: line range must not over-count (Task 4).
- File closed while its chip is dismissed, then reopened: chip returns (Task 5).
- Git missing or non-repo folder: treated as not ignored, never throws (Task 4).
- Send while relay is swapping: queued prompt still carries its blocks (Task 2).

---

### Task 1: Tag formatting and parsing (`src/shared/ideTags.ts`)

**Files:**
- Create: `src/shared/ideTags.ts`
- Test: `test/unit/shared/ideTags.test.ts`

**Interfaces:**
- Produces:
  - `interface IdeSelection { startLine: number; endLine: number; text?: string }`
  - `interface IdeContext { filePath: string; selection?: IdeSelection }`
  - `interface IdeChip { kind: 'file' | 'selection'; path: string; startLine?: number; endLine?: number }`
  - `const MAX_SELECTION_CHARS = 50_000`
  - `formatIdeBlocks(ctx: IdeContext): string[]` — one tag string (selection form, withheld form when `text === undefined`, else file form)
  - `parseIdeBlocks(text: string): { text: string; chips: IdeChip[] }` — removes recognized tags (all three forms) from `text`, trims the remainder, returns chips in order

- [ ] **Step 1: Write failing tests** in `test/unit/shared/ideTags.test.ts`: file form exact string; selection form exact string with multi-line text and path containing space, `$`, backtick passed through unchanged; withheld form exact string; 50,001-char text yields 50,000 chars then `\n[truncated 1 characters]` inside the block; `parseIdeBlocks` round-trips each form into the expected chip and leaves surrounding prompt text clean; text containing the literal `</ide_selection>` inside a selection still parses as one chip (parse by the first closing tag after the opening header that is followed by end or another tag/prompt text — builder picks the rule, test pins this case); plain text with no tags returns itself and `chips: []`.
- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement** the exports above in `src/shared/ideTags.ts`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(context): shared ide tag formatter and parser`.

### Task 2: Array content through host send path, plus the live CLI check

**Files:**
- Modify: `src/types/ipc.ts` (`ControlRequestMessage` gains `context?: IdeContext`), `src/process/ClaudeProcessManager.ts` (`sendUserMessage`), `src/ipc/MessageBroker.ts` (`IProcessManager.sendUserMessage` signature ~:38, `control_request` case ~:307), `src/relay/SessionRelayManager.ts` (`IRelayProcessManager.sendUserMessage` :21, `enqueueIfRelaying` :129, `queuedMessages`, flush ~:244)
- Create: `src/shared/userContent.ts`
- Test: `test/unit/shared/userContent.test.ts`, `test/unit/process/ide-context.acceptance.test.ts` (live, model on `test/unit/process/plan-approval.acceptance.test.ts`), update `test/unit/ipc/MessageBroker.test.ts` (:222), relay tests.

**Interfaces:**
- Consumes: `IdeContext`, `formatIdeBlocks` (Task 1)
- Produces:
  - `type UserContent = string | Array<{ type: 'text'; text: string }>`
  - `buildUserContent(text: string, context?: IdeContext): UserContent` — string when `context` undefined; else `[{type:'text',text}, ...formatIdeBlocks(context).map(...)]`
  - `sendUserMessage(channelId: string, content: UserContent): void` on `ClaudeProcessManager`, `IProcessManager`, `IRelayProcessManager`; `enqueueIfRelaying(channelId: string, content: UserContent): boolean`

- [ ] **Step 1: Live spike first.** Write `ide-context.acceptance.test.ts` (skipped unless `CLAUDE_ACCEPTANCE=1`): launch the real pinned `claude` via the same helper the plan-approval acceptance test uses, send `{type:'user', message:{role:'user', content:[{type:'text',text:'Repeat back the file path you were told I opened, nothing else.'},{type:'text',text:'<ide_opened_file>…/zz-probe.ts…</ide_opened_file>'}]}}` and assert the result text contains `zz-probe.ts`. Run it with `CLAUDE_ACCEPTANCE=1`. **If the CLI rejects the array form, record a ledger Ruling and make `buildUserContent` join blocks with `\n\n` into one string (spec fallback); the unit tests below then assert the joined string.** Expected: PASS with array.
- [ ] **Step 2: Write failing unit tests:** `buildUserContent('hi')` returns `'hi'`; with context returns two text blocks, second equal to `formatIdeBlocks(ctx)[0]`; `MessageBroker` `control_request` with `context` calls `sendUserMessage('ch-1', [blocks…])` and without calls it with `'hello'`; relay: `enqueueIfRelaying('ch', blocksContent)` then flush calls `sendUserMessage` with the identical array.
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement** `buildUserContent`; widen the signatures above; `ClaudeProcessManager.sendUserMessage` builds `{type:'user', message:{role:'user', content}}` and stores it in `outstandingTurns` unchanged; broker passes `buildUserContent(msg.text, msg.context)` to both `enqueueIfRelaying` and `sendUserMessage`.
- [ ] **Step 5: Run unit tests + both tsc projects, expect PASS.**
- [ ] **Step 6: Commit** `feat(context): send array content with ide blocks`.

### Task 3: Settings

**Files:**
- Modify: `package.json` (declare `clawdCode.attachOpenFile`, `clawdCode.attachSelection`, `clawdCode.respectGitIgnore`, boolean, default `true`, not application-scoped), `src/settings/ExtensionSettings.ts`
- Test: `test/unit/settings/ExtensionSettings.test.ts` (extend; model on the existing fallback tests)

**Interfaces:**
- Produces: `ExtensionSettings.getAttachOpenFile(): boolean`, `getAttachSelection(): boolean`, `getRespectGitIgnore(): boolean` (extend, or replace the unused `read().respectGitIgnore` plumbing so one source remains)

- [ ] **Step 1: Failing tests:** each getter defaults `true`; `claudeCode.attachOpenFile: false` with clawd key unset returns `false`; explicit `clawdCode.attachOpenFile: true` wins over `claudeCode.attachOpenFile: false`; same for the other two. Use mocked configuration, not the real user settings.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** reusing the existing clawd→claude fallback helper in `ExtensionSettings.ts`. **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat(context): attachOpenFile, attachSelection, respectGitIgnore settings`.

### Task 4: `EditorContextTracker` and host wiring

**Files:**
- Create: `src/context/EditorContextTracker.ts`
- Modify: `src/types/ipc.ts` (add `IdeContextMessage { type: 'ide_context'; context: IdeContext | null }` to `ToWebviewMessage`), `src/extension.ts` (construct near :228, subscribe disposables, give broker a `getIdeContext` service), `src/ipc/MessageBroker.ts` (on `list_sessions_request` also `webview.postMessage({type:'ide_context', context: services.getIdeContext?.() ?? null})`), `test/helpers/mockVscode.ts` (add `onDidChangeTextEditorSelection`, `onDidCloseTextDocument`, `workspace.findFiles`)
- Test: `test/unit/context/EditorContextTracker.test.ts`

**Interfaces:**
- Consumes: `IdeContext` (Task 1); settings getters (Task 3)
- Produces:
  - `type ExecFn = (cmd: string, args: string[], cwd: string) => Promise<{ code: number; killed?: boolean; stderr?: string }>`
  - `new EditorContextTracker(opts: { settings: Pick<ExtensionSettings,'getAttachOpenFile'|'getAttachSelection'|'getRespectGitIgnore'>; exec: ExecFn; onChange: (ctx: IdeContext | null) => void; debounceMs?: number })`
  - `.current(): IdeContext | null`; `.dispose()`
  - `.sanitize(ctx: IdeContext): Promise<IdeContext | null>` for the send-time check.
  - Registers its own VS Code listeners (active editor, selection of the active editor, content change of the tracked document, document close, tab close, configuration change, `.gitignore` watcher).

- [ ] **Step 1: Failing tests** (fake timers; one per bullet): non-`file` scheme ignored; selection from a non-active editor ignored; 300 ms debounce collapses a burst into one `onChange`; identical value not re-posted; the four-row settings table (`attachOpenFile`×`attachSelection`) yields the spec's chip/no-chip result; ignored file keeps `startLine/endLine` and omits `text` when `respectGitIgnore` on, includes `text` when off; exit 1, `ENOENT` and exit 128 with `not a git repository` → not ignored and cached; timeout, kill, rejection, other exit 128 and unrecognized codes → text withheld and not cached; `findFiles` returning `[]` → treated as excluded; `findFiles` throwing or hanging → text withheld and not cached; cache cleared on document close, on a `files.exclude` change and on each `.gitignore` change, create and delete; focus moving to a non-file editor keeps the last file context; closing that document yields `null`; selection ending at column 0 of line N+1 reports `endLine = N`; empty selection gives no `selection`; ignore result cached (exec called once for repeated events on same path).
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** `extension.ts` passes an exec built on `child_process.execFile` (same shape `WorktreeManager` injects) and `onChange` → `viewManager.broadcastMessage({type:'ide_context', context})`. **Step 4: Run unit tests + both tsc, PASS.**
- [ ] **Step 5: Add broker test:** `list_sessions_request` also posts `ide_context` with the tracker's current value (null when none). PASS.
- [ ] **Step 6: Commit** `feat(context): editor context tracker and ide_context broadcast`.

### Task 5: Composer chips and send

**Files:**
- Create: `webview-src/components/ContextChips.tsx` (+ `ContextChips.test.tsx`)
- Modify: `webview-src/lib/ipc.ts` (re-export `IdeContext`), `webview-src/store/extensionStore.ts` (`ideContext: IdeContext | null`, `IDE_CONTEXT` action, handle `ide_context`), `webview-src/components/ChatInput.tsx` (render chips, dismissal, `onSend(text, context?)`), `webview-src/App.tsx` (`handleSend(text, context?)` builds the optimistic event content from `[text, ...formatIdeBlocks(context)]` as text blocks when context exists, else the string), `webview-src/hooks/useSession.ts` (`sendText(channelId, text, requestId, context?)` posts `context` only when defined), `webview-src/components/ChatInput.test.tsx`, `webview-src/App.test.tsx` as exists

**Interfaces:**
- Consumes: `IdeContext`, `formatIdeBlocks` (Task 1), `ide_context` message (Task 4), `control_request.context` (Task 2)
- Produces: `ContextChips({ context, dismissed, onDismiss }: { context: IdeContext | null; dismissed: { file: boolean; selection: boolean }; onDismiss: (kind: 'file'|'selection') => void })`; `ChatInput` `onSend: (text: string, context?: IdeContext) => void`

- [ ] **Step 1: Failing tests:** chips render file (basename, full path in `title`) and selection (`basename:S-E`); remove hides one chip; send includes only the visible chips (dismissed selection → `context` has `filePath` only if file chip visible; both dismissed → `undefined`); a new line range or different path restores the chip; text-only change does not; closing the file (`null` then same path again) restores; both settings-off case arrives as `null` context so nothing renders; `App` dispatches an optimistic `user` event whose content is an array of text blocks containing the tag when context exists, string otherwise; `useSession.sendText` omits `context` key when undefined.
- [ ] **Step 2: Run webview tests, expect FAIL.** **Step 3: Implement.** If the webview build cannot import runtime code from `../../src/shared/ideTags`, duplicate the helper into `webview-src/lib/ideTags.ts` and add a parity test pinning identical outputs (spec fallback; record as a Ruling). **Step 4: Run webview tests + `tsc -p tsconfig.webview.json` + `pnpm build`-equivalent webview bundle, PASS.**
- [ ] **Step 5: Commit** `feat(context): composer chips and context on send`.

### Task 6: History rendering

**Files:**
- Modify: `webview-src/lib/conversationModel.ts` (`Turn` user variant gains `ide?: IdeChip[]`; `pushUserTurn` runs `parseIdeBlocks` on each text block before joining), `webview-src/components/UserTurn.tsx` (renders muted chips under the bubble), the caller of `UserTurn`
- Test: `webview-src/lib/conversationModel.test.ts`, `webview-src/components/UserTurn.test.tsx`

**Interfaces:**
- Consumes: `parseIdeBlocks`, `IdeChip` (Task 1)
- Produces: `Turn` user variant `{ kind:'user'; key:string; text:string; ide?: IdeChip[] }`; `UserTurn({ text, ide }: { text: string; ide?: IdeChip[] })`

- [ ] **Step 1: Failing tests:** a `user` event whose content is `[prompt, <ide_opened_file …>]` yields `text === prompt` and one file chip; a selection block yields a selection chip with lines; withheld form yields the same chip; official-extension shape (tags in separate text blocks, plus tags concatenated into one string) both work; a user event containing only a tag block still renders the chip turn (text empty but `ide` non-empty — do not drop it); `UserTurn` renders chips and no raw tag text; no `ide` prop renders as today.
- [ ] **Step 2: Run, FAIL.** **Step 3: Implement.** **Step 4: Run webview tests + tsc, PASS.**
- [ ] **Step 5: Commit** `feat(context): render ide tags in history as chips`.

### Task 7: Live round trip and parity doc

**Files:**
- Modify: `test/unit/process/ide-context.acceptance.test.ts` (extend Task 2's), `docs/parity.md`

- [ ] **Step 1:** Extend the live test through the real `MessageBroker` + `ClaudeProcessManager` path: a `control_request` with `context: {filePath, selection:{startLine:3,endLine:5,text:'const zzSecretMarker = 1'}}` reaches the model (reply contains `zzSecretMarker`), and a file-only context reply contains the path. Run with `CLAUDE_ACCEPTANCE=1`; paste the passing output in the report.
- [ ] **Step 2:** In `docs/parity.md` mark the open-file/selection context rows (and the `attachOpenFile`, `attachSelection`, `respectGitIgnore` settings rows) done for Phase 1A.
- [ ] **Step 3:** Run full host + webview suites, both tsc projects, `eslint src/ test/`. Expected: all green.
- [ ] **Step 4: Commit** `test(context): live round trip; docs: parity rows for 1A`.
