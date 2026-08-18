# Session Relay Design

Status: **proposed, not implemented**. This is a design doc, not a plan — it is the starting
point for a `superpowers:writing-plans` pass in a dedicated future session, followed by
`superpowers:subagent-driven-development` (this is real code, not the docs-only case that skips
that pipeline).

## Problem statement

`anti-compact` (a sibling plugin) blocks Claude Code's native `/compact` and hands the user a
copy-paste "handoff" prompt to seed a fresh session. That works for an interactive human sitting
at the terminal, but it assumes someone is present to notice the block and paste the handoff
into a new session. For a long-running or unattended/autonomous agent, nobody is watching —
blocking `/compact` just delays the problem until the transcript keeps growing against the same
uncompacted context, and in the worst case (a *reactive* recovery compaction, triggered because
the API already returned a context-limit error, as opposed to a *proactive* one) blocking it
outright fails the current turn. See `anti-compact`'s own `hooks/precompact-handoff.mjs` and its
`docs/how-it-works.md` for that mechanism; it is out of scope here except as the reason a purely
hook-based fix cannot solve the unattended case.

The deeper reason a hook-based approach cannot fix this: **a `PreCompact` hook cannot see live,
exact context usage.** It receives only `transcript_path` and has to estimate token count from
`chars / 4` — a rough proxy, not the real number. The exact figure (`get_context_usage`'s
`{totalTokens, maxTokens, percentage}`) is only reachable by whatever process is *driving* the
`claude` CLI's stdin/stdout directly in `--input-format/--output-format stream-json` mode — a
terminal, or an orchestrator like this extension. A hook running as a detached subprocess of the
CLI is structurally the wrong layer to fix this from. The fix belongs one layer up, in the
process that owns the CLI's stdio — which is exactly what `cc-vscode-ext` already is.

## Why this repo, not a new repo or anti-compact itself

- **anti-compact can't do this.** It operates purely through Claude Code's hook system, which
  never gets the exact context percentage and has no channel to inject a new turn into a
  *different* session and hand off UI continuity — hooks fire and exit, they don't own a
  long-lived process.
- **A new repo would just re-build what already exists here.** `cc-vscode-ext` already owns
  every primitive an autonomous relay needs:
  - it drives `claude` via `--input-format/--output-format stream-json`
    (`src/process/ProcessArgs.ts`);
  - it already polls the *exact* `get_context_usage` control response after relevant turns and
    broadcasts it to the webview (`MessageBroker.refreshContextUsage()`,
    `src/ipc/MessageBroker.ts:144-152`);
  - it can run multiple concurrent session processes, one per `channelId`
    (`ClaudeProcessManager`, `src/process/ClaudeProcessManager.ts`);
  - it already has a primitive for injecting a new user turn into a running process's stdin
    (`sendUserMessage()`, `src/process/ClaudeProcessManager.ts:103-105`).

  Building this anywhere else would duplicate that plumbing instead of extending it.

## Exact vs. estimated context usage — why this repo can do what a hook cannot

This is the load-bearing fact behind routing the fix here instead of deeper into anti-compact:

| | anti-compact (`PreCompact` hook) | cc-vscode-ext (this repo) |
|---|---|---|
| Context usage signal | estimated, `chars / 4` from `transcript_path` | exact, from the CLI's own `get_context_usage` control response (`{totalTokens, maxTokens, percentage}`) |
| Process lifetime | fires once per compaction attempt, then exits | owns the `claude` process for the life of the channel |
| Can inject a new turn into a *different* session | no — a hook has no persistent handle to any process | yes — `ClaudeProcessManager` already holds live process handles keyed by `channelId` |
| Can act *before* the CLI ever proposes compaction | no — reactive by construction, only runs when `PreCompact` fires | yes — can watch the exact percentage on every turn and act at any threshold it chooses |

Because the threshold can be tuned against the *real* percentage instead of a char-count proxy,
this design can relay well before the CLI's own compaction logic would ever fire — turning
context rot from "something to survive when the hook fires" into "something pre-empted before
it's ever relevant."

## Proposed design

### `src/relay/SessionRelayManager.ts` (new)

Watches the `get_context_usage` results already flowing through
`MessageBroker.refreshContextUsage()` (`src/ipc/MessageBroker.ts:144-152`, which currently
broadcasts a `context_usage` message per `ContextUsageMessage` in
`src/types/ipc.ts:406-410`). At a configurable threshold (~65-70% of `maxTokens` — chosen
independently of anti-compact's char/4-derived tuning, since this extension has the exact
percentage and doesn't need the same safety margin a rough estimate requires), triggers a relay
for that `channelId`.

Core method: `relay(channelId: string): Promise<void>` — orchestrates the handoff-and-swap
sequence described below. Should be unit-testable against a fake `IClaudeProcessManager` (see
Verification approach below) rather than a real spawned process.

### `src/relay/handoffPrompt.ts` (new)

Reuses anti-compact's own handoff system prompt (`hooks/lib/precompact.mjs`'s `SYSTEM_PROMPT` in
the `anti-compact` repo) copied verbatim into this file, with a
`// keep in sync with anti-compact/hooks/precompact-handoff.mjs` comment at the top. Not
extracted into a shared npm package — for a two-repo, ~40-line constant, package versioning
overhead is disproportionate to the payload; revisit only if a third consumer appears.

Because this extension already drives a live process (unlike anti-compact's hook, which has no
process to talk to), the handoff prompt is injected as a real user turn via the existing
`sendUserMessage()` (`src/process/ClaudeProcessManager.ts:103-105`) rather than by spawning an
isolated `claude -p` subprocess — cheaper, and avoids a second auth/session-init round-trip.

### `ClaudeProcessManager.swapChannel(channelId, options, cwd)` (new method)

`spawnClaude()` (`src/process/ClaudeProcessManager.ts:47-84`) currently throws if the channel is
already active (`:53-55`, `Channel "${channelId}" is already active`), and process cleanup runs
through `_cleanup()` (`:132-133`, `this.processes.delete(channelId)`) on `close`/`error` events.
A naive "close the old process, then spawn a new one under the same `channelId`" sequence has a
window between the close and the new spawn where a message directed at that channel would land
nowhere (the map entry is briefly absent).

`swapChannel` needs to atomically retire the old process handle and register the new one under
the same `channelId` in one map mutation, so `this.processes` (currently `Map<string,
ChildProcessLike>` populated at `:83`, `this.processes.set(channelId, proc)`) never observes a
gap for that key. This preserves UI identity — the webview's channel/tab doesn't need to know a
swap happened underneath it.

### New IPC types in `src/types/ipc.ts`

Following the existing patterns next to `ContextUsageMessage` (`:406-410`) and `SetModelMessage`
(`:198`):

- A `relay_started` broadcast message: `{ type: 'relay_started', channelId, fromSessionId,
  toSessionId }` — lets the webview show that a relay happened (e.g. a divider in the transcript)
  rather than silently swapping context out from under the user.
- A threshold get/set pair (mirroring `SetModelMessage`'s `channelId?`-scoped shape), so the
  relay threshold can be tuned per-channel from the webview rather than hardcoded.

### Real risk to design around: the permission-prompt race

This extension launches `claude` with `--permission-prompt-tool stdio` in its default permission
mode (`src/process/ProcessArgs.ts:37-38, 51-56`), which delegates tool-use permission prompts
back over the same stdio control channel the CLI uses for `get_context_usage` and friends
(`tool_permission_request` in `src/types/ipc.ts:272`, correlated via request IDs by
`ControlRequestManager` in `src/process/ControlRequest.ts`).

If a relay fires while a `tool_permission_request` is in flight on the *old* process, and
`swapChannel` force-closes that process, the pending control request is orphaned — the CLI is
waiting on a stdio reply that will never come, and whatever tool call triggered the prompt is
left in limbo. `SessionRelayManager.relay()` must check `ControlRequestManager` for a pending
request on that channel before swapping, and if one exists, defer the relay until the next
`result` event (i.e. until the current turn — including any pending permission round-trip —
actually completes) rather than force-closing mid-prompt. `ControlRequestManager` does not
currently expose a "has pending requests for this channel" query; adding one (or tracking it in
`SessionRelayManager` itself by listening for `control_request`/`control_response` events) is
part of the implementation work, not yet built.

### Verification approach

Unit-test `SessionRelayManager`'s `onContextUsage`/threshold logic against a fake
`IClaudeProcessManager` (the codebase already uses interface-based dependency injection
throughout `MessageBroker` for exactly this purpose — see `IClaudeProcessManager` in
`src/ipc/MessageBroker.ts:25`). Feed synthetic `percentage` values directly into the fake rather
than inflating a real transcript to hit a threshold — `get_context_usage` is already an exact
number, so there's no estimation logic to exercise the way anti-compact's `chars/4` proxy would
require.

Integration-level verification (once implemented) should additionally exercise the
permission-prompt race directly: start a relay-eligible channel, issue a tool call that requires
approval, fire a relay trigger mid-prompt, and assert the relay defers rather than orphaning the
pending `tool_permission_request`.

## Non-goals for this doc

This document intentionally does not specify: the exact default threshold value, the UI
treatment of `relay_started` in the webview transcript, or how per-channel threshold
configuration is persisted. Those are implementation-plan decisions for the
`superpowers:writing-plans` pass this doc feeds into, not design constraints fixed here.

## Provenance

This design was produced during a research session in the `anti-compact` repo
(`docs/_backlog.md`'s autonomous-session-relay entry), while implementing that repo's own
`PreCompact` reactive-recovery safety valve. The architecture findings above were verified
against this repo's actual code as of commit `d3acbc5` (branch `main`) — file:line citations
were re-checked at doc-writing time rather than copied blind from the originating session's
notes; two line-number citations (`MessageBroker.refreshContextUsage` and the `ContextUsage`
message-type block) had drifted slightly from the original research due to unrelated commits
landing on `main` in between, and are corrected above.
