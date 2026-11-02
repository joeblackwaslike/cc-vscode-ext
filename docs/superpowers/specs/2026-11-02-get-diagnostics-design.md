# getDiagnostics for the chat CLI (Phase 1C)

Parity target: official extension 2.1.314. Roadmap: `/Users/joe/.claude/plans/i-want-to-see-lexical-grove.md`, Phase 1C.

## Intent

The model should be able to read the errors and warnings VS Code shows in its Problems panel, including unsaved edits in open editors. The official extension exposes this as the MCP tool `mcp__claude-vscode__getDiagnostics`. clawd-code has no equivalent, so the model has to run a compiler or linter to learn what the editor already knows.

## How the official extension does it (read from the 2.1.314 bundle, confirmed against the real CLI)

The tool is served by an in-process SDK MCP server named `claude-vscode`. Nothing listens on a socket.

1. At startup the extension sends an `initialize` control request with `sdkMcpServers: ['claude-vscode']`.
2. The CLI then sends every MCP JSON-RPC message as a `control_request` with `subtype: 'mcp_message'`, `server_name`, and `message`.
3. The extension replies with a `control_response` whose payload is `{ mcp_response: <JSON-RPC response> }`.

A probe script against the installed `claude` (2.1.312) showed this sequence: `initialize`, `notifications/initialized` (no `id`), `tools/list`, an `experiment_gates` notification (a non-MCP method, no response needed), then `tools/call` with `arguments: {}` and `_meta`. The init event listed the server as `connected`, source `sdk`, and the tool as `mcp__claude-vscode__getDiagnostics`. The model returned the text the probe supplied. Our `ControlRequest.ts` header says no `initialize` handshake is needed. That stays true for existing requests, but this feature adds one.

## Goals

- `getDiagnostics` works in every chat session, including after a relay respawn or resume.
- Same tool name, input schema (`uri?: string`, a `file://` URI) and output shape as the official tool: a JSON array of `{ uri, linesInFile, diagnostics: [{ message, severity, range, source, code }] }`. The model behaves the same under either extension.
- Tool description and `readOnlyHint: true` annotation copied from the official tool, including the warning that many language servers only analyze open files, so an empty result can mean "not checked".

## Non-goals

- `openDiff`, `getOpenEditors`, `getCurrentSelection` and the rest of the IDE tool set. They belong to the WebSocket server (1B).
- Jupyter and any other tool on the `claude-vscode` server.
- A setting to disable the tool. The model chooses to call it, and the CLI's own permission flow governs MCP calls.

## Anti-goals

- Diagnostics from git-ignored or `files.exclude` files reaching the model while `clawdCode.respectGitIgnore` is on. Messages and paths from those files are as sensitive as their text. This reuses the 1A rule and its fail-closed table: a file whose status cannot be settled is withheld.
- A handshake failure breaking chat. If `initialize` returns an error response, the session runs without the tool and the failure is logged.

## Design

**Handshake.** `ClaudeProcessManager` sends the `initialize` control request right after every spawn (fresh, resume, relay respawn, retry without `--resume`). stdin is ordered, so the first user turn can follow immediately and does not wait for the response. The response is ignored; nothing in clawd-code uses the `commands` it carries today. An error response is logged (the generic `control_response` error warn in `MessageBroker.ts`) and not retried.

**Routing.** `MessageBroker`'s per-channel handler currently logs and drops unknown `control_request`s (`MessageBroker.ts`, the `ignoring unhandled control_request` branch). It gains a `mcp_message` case for `server_name === 'claude-vscode'`. It calls the responder and writes a `control_response` success with `{ mcp_response }`. An unknown `server_name` gets an error response. The existing drop stays for other subtypes.

**Responder** (`src/ide/DiagnosticsMcpServer.ts`, no `vscode` import, pure function from message to response). It handles:
- `initialize`: echo the client's `protocolVersion`, `capabilities: { tools: {} }`, `serverInfo: { name: 'claude-vscode', version }`.
- `tools/list`: the single tool.
- `tools/call` with `name: 'getDiagnostics'`: validate `uri` is an optional string, call the collector.
- `ping`: `{}`.
- Any message without an `id` (notifications, `experiment_gates`): `{ jsonrpc: '2.0', result: {}, id: 0 }`, which is what the official extension returns.
- Anything else with an `id`: JSON-RPC error `-32601`. Bad arguments: `-32602`.

**Collector** (`src/ide/diagnostics.ts`, uses `vscode`). It calls `vscode.languages.getDiagnostics(uri?)`, drops non-`file` schemes, then drops files that fail the ignore check. It maps severity to the enum name, converts ranges as the official code does, and reports `linesInFile` from open text documents.

**Withholding.** The ignore check is the one `EditorContextTracker` already has (git check-ignore plus the `files.exclude` probe, with the same timeouts, caching and fail-closed outcomes). If its methods are private, extract them into a small shared class rather than duplicating them. For an explicit `uri` that is withheld, the result is the JSON array `[]` plus a second text block: "Diagnostics withheld: the file is git-ignored, excluded, or could not be verified." For the all-files form, withheld files are omitted and the same second block states how many were withheld. With `respectGitIgnore` off, nothing is withheld.

**Size cap (my call).** The all-files form returns at most 200 files and 100 diagnostics per file, with a trailing text block stating how many were cut. A large workspace can otherwise put thousands of entries into one tool result. Both limits are named constants. Probes run in order in chunks of 8 and stop at 200 visible files, at `MAX_PROBED_FILES = 1000` probed files, or at the 20s collector deadline (`COLLECTOR_DEADLINE_MS`). Files not examined are counted in the trailing note, which names the time limit as one reason. The broker bounds its wait for the reply at 30s.

## Approaches considered

- **A. Handshake plus a minimal hand-rolled responder (chosen).** About 100 lines for the three methods the CLI uses, no new dependency, pure and testable.
- B. `@modelcontextprotocol/sdk` with an in-memory transport. Spec-correct, but it adds a dependency and bundle weight for one tool.
- C. A loopback HTTP MCP server passed through `--mcp-config`. Wrong layer: it opens a port, needs auth, and duplicates 1B.

## Testing

- Responder unit tests: each method, the `id`-less ack, `-32601`, `-32602`, and the exact tool description and annotation.
- Collector tests with the mocked `vscode`: severity mapping, `uri` filter, ignored and excluded files withheld, fail-closed on a timed-out check, respectGitIgnore off, caps and truncation note.
- Process manager test: `initialize` is the first stdin line on every spawn path, and a rejected response does not fail the launch.
- Broker test: `mcp_message` produces a matching `control_response`; an unknown `server_name` produces an error response; other subtypes are still dropped.
- Live acceptance test (`CLAUDE_ACCEPTANCE=1`) through the real broker and the real CLI: the model calls the tool and reports a seeded diagnostic; a seeded diagnostic in a git-ignored file does not appear; in `default` permission mode the CLI issued no `can_use_tool` for this read-only tool and ran it, and the test asserts exactly that; the cause was not isolated.

## Left to the builder

Where the `initialize` send lives in `ClaudeProcessManager`, the shared-ignore-checker extraction, the `serverInfo.version` source, and whether the `mcp_message` handler is a broker method or a small collaborator.

## Known gaps

The ignore check inherits the 1A gap: the `.gitignore` watcher misses `.git/info/exclude` and the global excludes file.


The ignore check refreshes its cache entry on every `getDiagnostics` call, so each call re-probes the files it examines. The check is `git check-ignore`, which does read `.git/info/exclude` and the global excludes file; the watcher gap affects only the 1A composer chip cache.

Diagnostics for a file that is not ignored can still quote text or paths from an ignored file, for example a type error showing a literal imported from an ignored file. This is inherent to the feature and the same as the official extension.

When the workspace was opened through a symlink and a language server reports a realpath outside the workspace folder, the `files.exclude` probe finds no workspace folder and reports "not excluded". The git check is unaffected.

A reply to an `mcp_message` goes to the channel by id, so a request in flight during a relay swap or stale-resume respawn may be answered to the new process, which ignores it.
