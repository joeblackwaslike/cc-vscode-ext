# getDiagnostics for the chat CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat CLI can call `mcp__claude-vscode__getDiagnostics` and read VS Code's Problems panel, with ignored files withheld.

**Architecture:** On every spawn we send an `initialize` control request naming an SDK MCP server `claude-vscode`. The CLI tunnels MCP JSON-RPC to us as `mcp_message` control requests. A pure responder answers `initialize`, `tools/list`, `tools/call`; a collector reads `vscode.languages.getDiagnostics` and drops files the 1A ignore check withholds.

**Tech Stack:** TypeScript, vitest (`--pool=forks`), VS Code API. Run tools via `node_modules/.bin`.

**Spec:** `docs/superpowers/specs/2026-11-02-get-diagnostics-design.md`

## Global Constraints

- Tool name `getDiagnostics`, server name `claude-vscode`, annotations `{ title: 'Get diagnostics', readOnlyHint: true }`.
- Tool description, verbatim: "Get the errors, warnings and other diagnostics VS Code currently shows in its Problems panel, including those for unsaved changes in open editors. Returns a JSON array with one entry per file. Pass `uri` to check one file, or omit it to get every file VS Code currently has diagnostics for. Many language extensions only analyze open files, so a missing file or an empty list can mean the file has not been checked, not that it is clean."
- `uri` input description, verbatim: "file:// URI of the one file to check. Omit to get every file VS Code currently has diagnostics for."
- Output entry shape: `{ uri, linesInFile, diagnostics: [{ message, severity, range: {start:{line,character}, end:{line,character}}, source, code }] }`. `severity` is the `vscode.DiagnosticSeverity` enum name.
- Ignored or `files.exclude` files are withheld while `respectGitIgnore` is on; an unsettled check withholds (fail closed).
- Caps (named constants): `MAX_DIAGNOSTIC_FILES = 200`, `MAX_DIAGNOSTICS_PER_FILE = 100`.
- A failed `initialize` never fails a launch.
- No `vscode` import in `src/ide/DiagnosticsMcpServer.ts`. No inline comments, no section banners.

## Review Focus

- `uri` that is malformed or not `file:`: returns `[]`, never throws or leaks another file.
- Ignore check that times out or errors: that file is withheld, not returned.
- A workspace with thousands of diagnostic files: result is capped and says how many were cut.
- A JSON-RPC request whose `id` is a number or a string: the response echoes it unchanged.
- `stdin` already closed when `initialize` is written: the launch still succeeds.

---

### Task 1: MCP responder

**Files:**
- Create: `src/ide/DiagnosticsMcpServer.ts`
- Test: `test/unit/ide/DiagnosticsMcpServer.test.ts`

**Interfaces:**
- Produces:
  - `export const DIAGNOSTICS_SERVER_NAME = 'claude-vscode'`
  - `export type ToolTextBlock = { type: 'text'; text: string }`
  - `export type CollectDiagnostics = (uri: string | undefined) => Promise<ToolTextBlock[]>`
  - `export function handleMcpMessage(message: unknown, collect: CollectDiagnostics): Promise<Record<string, unknown>>` returning the JSON-RPC response object that goes in `mcp_response`.

- [ ] **Step 1: Write failing tests** in `test/unit/ide/DiagnosticsMcpServer.test.ts`:
  - `initialize echoes the client protocolVersion and advertises tools`: result `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'claude-vscode', version: <string> } }`, `id` echoed.
  - `tools/list returns the single tool with the verbatim description, uri schema and annotations`.
  - `tools/call getDiagnostics passes uri to collect and returns its blocks as content`.
  - `tools/call with no arguments passes undefined`.
  - `tools/call with a non-string uri returns error -32602`.
  - `tools/call for another tool name returns error -32602`.
  - `ping returns an empty result`.
  - `a message without an id (notifications/initialized, experiment_gates) returns { jsonrpc: '2.0', result: {}, id: 0 }`.
  - `an unknown method with an id returns error -32601`.
  - `a collector that throws returns a tool result with isError: true and the message, not a JSON-RPC error`.
- [ ] **Step 2:** Run `node_modules/.bin/vitest run --pool=forks test/unit/ide/DiagnosticsMcpServer.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `handleMcpMessage` per the signature. Version comes from a `const SERVER_VERSION = '1.0.0'`.
- [ ] **Step 4:** Re-run the test file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ide): MCP responder for the claude-vscode diagnostics server`.

### Task 2: Diagnostics collector and tracker hook

**Files:**
- Create: `src/ide/diagnostics.ts`
- Modify: `src/context/EditorContextTracker.ts` (add public method near `sanitize`)
- Modify: `test/helpers/mockVscode.ts` (add `languages.getDiagnostics`, `DiagnosticSeverity`, `workspace.textDocuments` if missing; settable per test)
- Test: `test/unit/ide/diagnostics.test.ts`, extend `test/unit/context/EditorContextTracker.test.ts`

**Interfaces:**
- Consumes: `ToolTextBlock`, `CollectDiagnostics` (Task 1).
- Produces:
  - `EditorContextTracker.isWithheld(uri: vscode.Uri): Promise<boolean>`: true when `getRespectGitIgnore()` is on and the existing private `isIgnored(uri)` is true.
  - `export function createDiagnosticsCollector(deps: { isWithheld: (uri: vscode.Uri) => Promise<boolean> }): CollectDiagnostics`
  - `export const MAX_DIAGNOSTIC_FILES = 200`, `export const MAX_DIAGNOSTICS_PER_FILE = 100`

- [ ] **Step 1: Write failing tests.** Collector (`diagnostics.test.ts`):
  - `maps severity names, ranges, source and code`; an object `code` `{ value, target }` becomes its `value`.
  - `reports linesInFile for open documents and omits it otherwise`.
  - `uri filters to one file`; `a malformed uri returns [] as JSON`; `a non-file scheme returns [] as JSON`.
  - `withheld file is omitted and a second text block states the count`.
  - `an explicit uri that is withheld returns [] plus the sentence "Diagnostics withheld: the file is git-ignored, excluded, or could not be verified."`.
  - `isWithheld rejecting counts as withheld`.
  - `caps files at MAX_DIAGNOSTIC_FILES and diagnostics per file at MAX_DIAGNOSTICS_PER_FILE with a note of how many were cut`.
  - `non-file schemes are dropped from the all-files form`.
  Tracker tests: `isWithheld is false when respectGitIgnore is off even for an ignored file`; `isWithheld is true for a git-ignored file`; `isWithheld is true when the git check times out`.
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3: Implement** `createDiagnosticsCollector` in `src/ide/diagnostics.ts` and `isWithheld` on the tracker (reuse `isIgnored`; no duplicate probe). First block is `JSON.stringify(entries, null, 2)`.
- [ ] **Step 4:** Run both files plus `node_modules/.bin/tsc --noEmit -p tsconfig.extension.json`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ide): diagnostics collector that withholds ignored files`.

### Task 3: Send `initialize` on every spawn

**Files:**
- Modify: `src/process/ClaudeProcessManager.ts` (`_launchProcess`, after the `stdout`, `stderr`, `close` handlers are attached)
- Modify: `src/process/ControlRequest.ts` (header comment only: mention the `initialize` handshake is now sent by the process manager)
- Test: `test/unit/process/ClaudeProcessManager.test.ts`

**Interfaces:**
- Consumes: `DIAGNOSTICS_SERVER_NAME` (Task 1).
- Produces: first stdin line of every process is `{"type":"control_request","request_id":"cc_init_<channelId>","request":{"subtype":"initialize","sdkMcpServers":["claude-vscode"]}}`.

- [ ] **Step 1: Write failing tests**, using the file's existing fake-spawn stdin capture:
  - `writes initialize as the first stdin line on spawnClaude`.
  - `writes initialize again on a relay swapChannel respawn`.
  - `writes initialize again on the stale --resume retry`.
  - `does not throw when stdin write fails`.
- [ ] **Step 2:** Run the file. Expected: the four new tests FAIL; existing tests that assert exact stdin contents may need `initialize` filtered out, adjust them.
- [ ] **Step 3: Implement** the write inside a try/catch that logs at warn.
- [ ] **Step 4:** Run `node_modules/.bin/vitest run --pool=forks test/unit/process`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(process): send the SDK MCP initialize handshake on every spawn`.

### Task 4: Route `mcp_message` in the broker

**Files:**
- Modify: `src/ipc/MessageBroker.ts` (`MessageBrokerServices`, the per-channel handler near the `control_response` and `ignoring unhandled control_request` branches)
- Modify: `src/extension.ts` (pass the collector in the services object next to `sanitizeIdeContext`)
- Test: `test/unit/ipc/MessageBroker.test.ts` (or the broker test file already used for control requests)

**Interfaces:**
- Consumes: `handleMcpMessage`, `DIAGNOSTICS_SERVER_NAME` (Task 1); `createDiagnosticsCollector` (Task 2).
- Produces: `MessageBrokerServices.collectDiagnostics?: CollectDiagnostics`. For `{type:'control_request', request_id, request:{subtype:'mcp_message', server_name:'claude-vscode', message}}` the broker writes `{type:'control_response', response:{subtype:'success', request_id, response:{mcp_response}}}` to the channel. Unknown `server_name`, or no `collectDiagnostics` service, writes `{subtype:'error', request_id, error}`. An unhandled `control_response` with `subtype: 'error'` is logged at warn.

- [ ] **Step 1: Write failing tests**:
  - `answers an mcp_message tools/list with an mcp_response echoing the id`.
  - `answers tools/call by invoking the collector`.
  - `unknown server_name gets an error control_response`.
  - `no collectDiagnostics service gets an error control_response`.
  - `other control_request subtypes are still dropped without a response`.
  - `an error control_response nobody is waiting for is logged`.
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3: Implement** the branch before the generic `control_request` drop. Wire `collectDiagnostics: createDiagnosticsCollector({ isWithheld: (u) => editorContext.isWithheld(u) })` in `src/extension.ts`.
- [ ] **Step 4:** Run `node_modules/.bin/vitest run --pool=forks`, `tsc --noEmit -p tsconfig.extension.json`, `tsc --noEmit -p tsconfig.webview.json`, `oxlint src test webview-src`. Expected: all clean.
- [ ] **Step 5: Commit** `feat(ide): answer claude-vscode MCP messages in the broker`.

### Task 5: Live acceptance test and parity doc

**Files:**
- Create: `test/unit/process/ide-diagnostics.acceptance.test.ts` (gated by `CLAUDE_ACCEPTANCE=1`, modeled on `ide-context.acceptance.test.ts`)
- Modify: `docs/parity.md` (mark `getDiagnostics` done, 1C)

**Interfaces:**
- Consumes: the real `ChannelRouter`, `ClaudeProcessManager`, `MessageBroker` with a collector whose `vscode.languages.getDiagnostics` is the mocked source.

- [ ] **Step 1: Write the live tests** through the real broker and real CLI:
  - `model calls getDiagnostics and reports a seeded diagnostic`.
  - `a seeded diagnostic in a git-ignored file does not appear in the model's answer or the tool result`.
  - `in default permission mode the CLI issues no can_use_tool for the read-only tool and the call succeeds`.
- [ ] **Step 2:** Run `CLAUDE_ACCEPTANCE=1 node_modules/.bin/vitest run --pool=forks test/unit/process/ide-diagnostics.acceptance.test.ts`. Expected: PASS (3/3). If the default-mode case fails because the CLI never asks, record what it does and assert that instead.
- [ ] **Step 3:** Update the `docs/parity.md` row. Run the full suite and linters once more.
- [ ] **Step 4: Commit** `test(ide): live getDiagnostics acceptance and parity row`.
