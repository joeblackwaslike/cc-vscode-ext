# SessionRelayManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autonomously relay a channel's `claude` session to a fresh process once context usage crosses a threshold, seeding the new process with a distilled handoff instead of letting context grow unbounded — without a human having to notice and paste a handoff.

**Architecture:** A new `SessionRelayManager` watches `get_context_usage` results already flowing through `MessageBroker.refreshContextUsage()`. When a channel crosses threshold and has no permission prompt in flight, it injects anti-compact's handoff prompt as a real user turn via the existing `sendUserMessage()`, captures the assistant's response text and session id from the resulting `result` event, atomically swaps the channel to a brand-new (non-resumed) process via a new `ClaudeProcessManager.swapChannel()`, and reseeds that new process with the captured handoff text as its first turn. A `relay_started` message tells the webview a swap happened.

**Tech Stack:** TypeScript, vitest (hoisted-mock unit tests), existing interface-based DI pattern (`I*` interfaces + fakes, no mocking framework beyond vitest).

**Spec:** [docs/session-relay-design.md](../../session-relay-design.md) — re-verified against `main` at commit `f58dd2c` while writing this plan; two things drifted and are corrected in this plan:
1. `ChannelRouter` is now its own class (`src/process/ChannelRouter.ts`) — `ClaudeProcessManager._cleanup()` calls `this.router.unregister(channelId)` in addition to deleting from the process map. This makes the design doc's "known gap" sharper than it stated: a stale close/error handler from the *old* process doesn't just risk deleting the new process's map entry, it can also unregister the router handler the new process depends on for every future event. Task 2 below fixes this at the root (identity-checked cleanup) rather than patching around it.
2. `refreshContextUsage`/`ContextUsageMessage`/`SetModelMessage` line numbers cited in the design doc still match current `main` — no correction needed there.

---

## File Structure

- **Modify** `src/process/ControlRequest.ts` — track `channelId` per pending request; add `hasPending(channelId)`.
- **Modify** `src/process/ClaudeProcessManager.ts` — identity-checked cleanup (`_cleanupIfCurrent`) closing the swap race; new `swapChannel()` method.
- **Modify** `src/types/ipc.ts` — four new message types (`relay_started`, `get_relay_threshold`, `set_relay_threshold`, `relay_threshold`).
- **Create** `src/relay/handoffPrompt.ts` — the handoff system prompt, copied from `anti-compact`.
- **Create** `src/relay/SessionRelayManager.ts` — the core relay orchestrator.
- **Modify** `src/ipc/MessageBroker.ts` — wire `SessionRelayManager` into launch, context-usage refresh, result events, close, and the two new message types.
- **Modify** `webview-src/store/sessionStore.ts` — turn a `relay_started` broadcast into a synthetic `relay_marker` transcript event (state only; rendering is explicitly out of scope per the design doc's non-goals).

Each file above gets its own task, in dependency order (leaf modules first).

---

### Task 1: `ControlRequestManager.hasPending()`

**Files:**
- Modify: `src/process/ControlRequest.ts`
- Test: `test/unit/process/ControlRequest.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/process/ControlRequest.test.ts` (after the existing `'ignores responses for unknown request_ids'` test):

```typescript
  it('hasPending() is true while a request for that channel is in flight', () => {
    const { mgr } = makeManager();
    expect(mgr.hasPending('ch1')).toBe(false);
    mgr.send('ch1', 'get_context_usage').catch(() => {});
    expect(mgr.hasPending('ch1')).toBe(true);
    mgr.dispose();
  });

  it('hasPending() is false for a different channel', () => {
    const { mgr } = makeManager();
    mgr.send('ch1', 'get_context_usage').catch(() => {});
    expect(mgr.hasPending('ch2')).toBe(false);
    mgr.dispose();
  });

  it('hasPending() is false once the request settles', async () => {
    const { mgr } = makeManager();
    const p = mgr.send('ch1', 'get_context_usage');
    mgr.handleResponse({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'req_1' },
    } as ControlResponseEvent);
    await p;
    expect(mgr.hasPending('ch1')).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/process/ControlRequest.test.ts`
Expected: FAIL — `mgr.hasPending is not a function`

- [ ] **Step 3: Implement `hasPending()`**

In `src/process/ControlRequest.ts`, add `channelId` to the `Pending` interface and record it in `send()`:

```typescript
interface Pending {
  channelId: string;
  resolve: (response: Record<string, unknown> | undefined) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
```

In `send()`, change the `this.pending.set(requestId, { resolve, reject, timer });` line to:

```typescript
      this.pending.set(requestId, { channelId, resolve, reject, timer });
```

Add a new public method (after `handleResponse`):

```typescript
  /** True if any control_request for this channel is still awaiting a response. */
  hasPending(channelId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.channelId === channelId) return true;
    }
    return false;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/process/ControlRequest.test.ts`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/process/ControlRequest.ts test/unit/process/ControlRequest.test.ts
git commit -m "feat(relay): add ControlRequestManager.hasPending(channelId)"
```

---

### Task 2: Identity-checked cleanup in `ClaudeProcessManager`

**Files:**
- Modify: `src/process/ClaudeProcessManager.ts`
- Test: `test/unit/process/ClaudeProcessManager.test.ts`

This is a pure refactor of `_cleanup` — no new public API yet. It exists as its own task because Task 3 (`swapChannel`) depends on it, and it needs its own regression test proving a stale handler can no longer clobber a live entry.

- [ ] **Step 1: Write the failing test**

Add to `test/unit/process/ClaudeProcessManager.test.ts` (near the other `'close'`/`'error'` event tests):

```typescript
  it('a stale close handler from a replaced process does not delete the current entry', async () => {
    const { manager, router } = makeManager();
    await manager.spawnClaude('ch-1', {});
    // Simulate an external replace of the map entry for ch-1 (what swapChannel
    // will do in Task 3) without going through manager's own APIs, so this test
    // exercises only the identity check in isolation.
    const currentHandlers = mockProcess.on.mock.calls.slice(); // capture ch-1's own handlers
    const replacement = { ...mockProcess, kill: vi.fn() };
    (manager as unknown as { processes: Map<string, unknown> }).processes.set('ch-1', replacement);

    for (const call of currentHandlers as [string, (...a: unknown[]) => void][]) {
      if (call[0] === 'close') call[1](0); // fire ch-1's now-stale close handler
    }

    expect(manager.hasChannel('ch-1')).toBe(true);
    const handler = vi.fn();
    router.register('ch-1', handler);
    router.route('ch-1', { type: 'still-here' });
    expect(handler).toHaveBeenCalledWith({ type: 'still-here' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/process/ClaudeProcessManager.test.ts -t "stale close handler"`
Expected: FAIL — `hasChannel('ch-1')` is `false` (the stale handler wrongly deleted the replacement) and/or the router handler was already unregistered.

- [ ] **Step 3: Implement identity-checked cleanup**

In `src/process/ClaudeProcessManager.ts`, replace the private `_cleanup` method:

```typescript
  private _cleanup(channelId: string): void {
    this.processes.delete(channelId);
    this.router.unregister(channelId);
  }
```

with:

```typescript
  /**
   * Cleanup a process's map/router entries, but only if `proc` is still the
   * entry registered for `channelId`. A process's close/error handlers are
   * bound at spawn time; if that channelId has since been reassigned to a
   * different process (see swapChannel), the old handler must not tear down
   * the new process's registration.
   */
  private _cleanupIfCurrent(channelId: string, proc: ProcessHandle): void {
    if (this.processes.get(channelId) !== proc) return;
    this.processes.delete(channelId);
    this.router.unregister(channelId);
  }
```

Update all three call sites to pass `proc` and use the new name. In `spawnClaude()`:

```typescript
    proc.on('close', (code: unknown) => {
      this.logger.info(`[channel:${channelId}] closed (code=${String(code)})`);
      this._cleanupIfCurrent(channelId, proc);
    });

    proc.on('error', (err: unknown) => {
      this.logger.error(`[channel:${channelId}] process error`, err);
      this._cleanupIfCurrent(channelId, proc);
    });
```

In `closeChannel()`:

```typescript
  closeChannel(channelId: string): void {
    const proc = this.processes.get(channelId);
    if (proc === undefined) return;
    proc.kill();
    this._cleanupIfCurrent(channelId, proc);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/process/ClaudeProcessManager.test.ts`
Expected: PASS — all existing tests plus the new one (the existing suite has no other references to `_cleanup` by name, so this is a safe rename).

- [ ] **Step 5: Commit**

```bash
git add src/process/ClaudeProcessManager.ts test/unit/process/ClaudeProcessManager.test.ts
git commit -m "fix(process): identity-check cleanup so a stale handler can't clobber a replaced channel entry"
```

---

### Task 3: `ClaudeProcessManager.swapChannel()`

**Files:**
- Modify: `src/process/ClaudeProcessManager.ts`
- Test: `test/unit/process/ClaudeProcessManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/process/ClaudeProcessManager.test.ts`:

```typescript
  describe('swapChannel()', () => {
    it('spawns a new process and keeps the channel active under the same id', async () => {
      const { manager } = makeManager();
      await manager.spawnClaude('ch-1', {});
      expect(manager.hasChannel('ch-1')).toBe(true);

      await manager.swapChannel('ch-1', {});

      expect(manager.hasChannel('ch-1')).toBe(true);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('kills the old process', async () => {
      const { manager } = makeManager();
      await manager.spawnClaude('ch-1', {});
      const oldKill = mockProcess.kill;

      await manager.swapChannel('ch-1', {});

      expect(oldKill).toHaveBeenCalled();
    });

    it('routes stdout from the new process through the same router registration', async () => {
      const { manager, router } = makeManager();
      const handler = vi.fn();
      router.register('ch-1', handler);
      await manager.spawnClaude('ch-1', {});

      await manager.swapChannel('ch-1', {});
      triggerStdoutData(Buffer.from(JSON.stringify({ type: 'from-new-proc' }) + '\n'));

      expect(handler).toHaveBeenCalledWith({ type: 'from-new-proc' });
    });

    it("the old process's own close/error handlers do not tear down the new entry", async () => {
      const { manager, router } = makeManager();
      const handler = vi.fn();
      router.register('ch-1', handler);
      await manager.spawnClaude('ch-1', {});
      const oldHandlerCalls = mockProcess.on.mock.calls.slice();

      await manager.swapChannel('ch-1', {});
      // Fire the *old* process's close handler, simulating it finishing shutdown
      // asynchronously after the swap already completed.
      for (const call of oldHandlerCalls as [string, (...a: unknown[]) => void][]) {
        if (call[0] === 'close') call[1](0);
      }

      expect(manager.hasChannel('ch-1')).toBe(true);
      router.route('ch-1', { type: 'still-routed' });
      expect(handler).toHaveBeenCalledWith({ type: 'still-routed' });
    });

    it('spawns with a fresh binary/args for the new process using the given options', async () => {
      const { manager } = makeManager();
      await manager.spawnClaude('ch-1', { resume: 'old-sess' });

      await manager.swapChannel('ch-1', { permissionMode: 'acceptEdits' }, '/workspace');

      expect(buildArgs).toHaveBeenLastCalledWith({ permissionMode: 'acceptEdits' });
      expect(mockSpawn).toHaveBeenLastCalledWith(
        '/usr/local/bin/claude',
        expect.anything(),
        expect.objectContaining({ cwd: '/workspace' }),
      );
    });

    it('works when there is no existing process for the channel (cold swap)', async () => {
      const { manager } = makeManager();
      await manager.swapChannel('ch-1', {});
      expect(manager.hasChannel('ch-1')).toBe(true);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/process/ClaudeProcessManager.test.ts -t "swapChannel"`
Expected: FAIL — `manager.swapChannel is not a function`

- [ ] **Step 3: Implement `swapChannel()`**

In `src/process/ClaudeProcessManager.ts`, add a new public method after `spawnClaude()`:

```typescript
  /**
   * Atomically replace the process behind an already-active channelId with a
   * freshly spawned one, without ever letting `this.processes` observe a gap
   * for that key. Unlike spawnClaude, this does not throw if the channel is
   * already active — replacing an active channel is the whole point.
   *
   * The old process (if any) is killed after the new one is registered; its
   * close/error handlers are bound to the old ProcessHandle instance, so
   * `_cleanupIfCurrent` no-ops for them once the map holds the new instance.
   */
  async swapChannel(
    channelId: string,
    options: ProcessLaunchOptions,
    cwd?: string,
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    const oldProc = this.processes.get(channelId);

    const binary = options.wrapper ?? (await this.binaryProvider());
    const args = buildArgs(options);

    const proc = this.spawnFn(binary, args, {
      cwd: cwd ?? process.cwd(),
      env: env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const parser = new StreamJsonParser(
      (event) => this.router.route(channelId, event),
      (line) => this.logger.warn(`[channel:${channelId}] bad JSON: ${line}`),
    );

    proc.stdout.on('data', (chunk: Buffer) => parser.feed(chunk.toString()));

    proc.on('close', (code: unknown) => {
      this.logger.info(`[channel:${channelId}] closed (code=${String(code)})`);
      this._cleanupIfCurrent(channelId, proc);
    });

    proc.on('error', (err: unknown) => {
      this.logger.error(`[channel:${channelId}] process error`, err);
      this._cleanupIfCurrent(channelId, proc);
    });

    this.processes.set(channelId, proc);

    if (oldProc !== undefined) {
      oldProc.kill();
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/process/ClaudeProcessManager.test.ts`
Expected: PASS — full file, including all pre-existing tests.

- [ ] **Step 5: Run the full unit suite and typecheck**

Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/process/ClaudeProcessManager.ts test/unit/process/ClaudeProcessManager.test.ts
git commit -m "feat(process): add ClaudeProcessManager.swapChannel() for in-place process replacement"
```

---

### Task 4: New IPC message types

**Files:**
- Modify: `src/types/ipc.ts`

No test file — this task is pure type additions, verified by `tsc --noEmit` and by the tests in Tasks 6–7 that construct these types.

- [ ] **Step 1: Add the two new `FromWebviewMessage` types**

In `src/types/ipc.ts`, near `GetContextUsageMessage` (around line 60), add:

```typescript
export interface GetRelayThresholdMessage { type: 'get_relay_threshold'; channelId?: string }
export interface SetRelayThresholdMessage { type: 'set_relay_threshold'; threshold: number; channelId?: string }
```

Add both to the `FromWebviewMessage` union (near `GetContextUsageMessage`'s entry, around line 289):

```typescript
  | GetContextUsageMessage
  | GetRelayThresholdMessage
  | SetRelayThresholdMessage
```

- [ ] **Step 2: Add the two new `ToWebviewMessage` types**

Near `ContextUsageMessage` (around line 406), add:

```typescript
/** Sent once a SessionRelayManager swap completes, so the webview can mark the transcript. */
export interface RelayStartedMessage {
  type: 'relay_started';
  channelId: string;
  fromSessionId?: string;
  toSessionId?: string;
}

/** Current relay threshold (percentage, 0-100) for a channel, or the global default when channelId is omitted. */
export interface RelayThresholdMessage {
  type: 'relay_threshold';
  channelId?: string;
  threshold: number;
}
```

Add both to the `ToWebviewMessage` union (near `ContextUsageMessage`'s entry, around line 524):

```typescript
  | ContextUsageMessage
  | RelayStartedMessage
  | RelayThresholdMessage
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/types/ipc.ts
git commit -m "feat(ipc): add relay_started and relay threshold get/set message types"
```

---

### Task 5: `src/relay/handoffPrompt.ts`

**Files:**
- Create: `src/relay/handoffPrompt.ts`

Copied verbatim from `anti-compact`'s `hooks/precompact-handoff.mjs` (`SYSTEM_PROMPT` constant), as of that repo's commit `ff10814` (the commit that last touched that file, per `git log -1 -- hooks/precompact-handoff.mjs` in `anti-compact` on 2026-08-18). Re-verify against the live file if this task runs later and the text may have drifted.

- [ ] **Step 1: Create the file**

```typescript
/**
 * keep in sync with anti-compact/hooks/precompact-handoff.mjs @ ff10814
 * (SYSTEM_PROMPT constant). anti-compact uses this as a --system-prompt for
 * an isolated `claude -p` judge process fed the transcript as input; here it
 * is injected as a normal user turn into the live process instead (this repo
 * already owns that process's stdin, so no second process is needed).
 */
export const HANDOFF_SYSTEM_PROMPT = `You are creating a session handoff document. The session is about to be interrupted.

Produce a structured handoff that preserves ALL important context so work can continue seamlessly in a new session. Include:
- Original task and overall goal
- Key decisions made and WHY (rationale matters, not just what was decided)
- Current state: what's done, what's in progress, what's blocked
- Specific commands, file paths, issue IDs (never generalize these — list them exactly)
- Any mistakes encountered and their solutions
- Next concrete steps with specific issue IDs or commands

Be thorough. This handoff must preserve more context than an automated summary.

CONVERSATION:`;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/relay/handoffPrompt.ts
git commit -m "feat(relay): add handoff system prompt copied from anti-compact"
```

---

### Task 6: `src/relay/SessionRelayManager.ts`

**Files:**
- Create: `src/relay/SessionRelayManager.ts`
- Test: `test/unit/relay/SessionRelayManager.test.ts`

This is the core orchestrator. Dependency interfaces are defined locally in this file (matching the `IClaudeProcessManager`/`IViewManager` pattern already used in `src/ipc/MessageBroker.ts`), so this class is unit-testable with plain fakes and no real process/CLI involved — matching the design doc's "Verification approach" section.

**Design notes carried over from the spec, made concrete here:**
- `onContextUsage` triggers `relay()` when `usage.percentage >= threshold`. Default threshold is `70` (percent), overridable globally or per-channel via `setThreshold()`.
- `relay()` guards against re-entrancy (a `relaying` Set) and defers (silently returns) if `control.hasPending(channelId)` is true — the *next* `onContextUsage` call, which naturally follows the next `result` event once the in-flight permission prompt resolves, will retry.
- The handoff sequence reuses one mechanism twice: `captureNextResult()` registers a one-shot resolver keyed by channelId; `handleStreamEvent()` (called by MessageBroker for every `result` event) resolves it with `{text, sessionId}` extracted from that event. First capture = the handoff response (asked for on the *old* process). Second capture = the reseed turn's response (asked for on the *new* process, after `swapChannel`) — this is what supplies `toSessionId` for `relay_started`, using the exact same code path rather than a second mechanism.
- `registerLaunch()`/`unregisterChannel()` track the `{options, cwd}` a channel was launched with, so `relay()` knows how to spawn the replacement (with `resume` stripped — a relay is deliberately a *fresh* session, not a resume of the huge one being escaped).

- [ ] **Step 1: Write the failing tests**

Create `test/unit/relay/SessionRelayManager.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SessionRelayManager } from '../../../src/relay/SessionRelayManager';
import { HANDOFF_SYSTEM_PROMPT } from '../../../src/relay/handoffPrompt';

function makeFakes() {
  const sendUserMessage = vi.fn();
  const swapChannel = vi.fn(() => Promise.resolve());
  const hasPending = vi.fn(() => false);
  const broadcastMessage = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const processManager = { sendUserMessage, swapChannel };
  const control = { hasPending };
  const viewManager = { broadcastMessage };

  const relay = new SessionRelayManager(processManager, control, viewManager, logger);
  return { relay, processManager, control, viewManager, logger, sendUserMessage, swapChannel, hasPending, broadcastMessage };
}

function usage(percentage: number) {
  return { categories: [], totalTokens: percentage * 1000, maxTokens: 100_000, percentage };
}

describe('SessionRelayManager', () => {
  describe('threshold', () => {
    it('defaults to 70', () => {
      const { relay } = makeFakes();
      expect(relay.getThreshold()).toBe(70);
    });

    it('setThreshold() with no channelId changes the global default', () => {
      const { relay } = makeFakes();
      relay.setThreshold(50);
      expect(relay.getThreshold()).toBe(50);
      expect(relay.getThreshold('ch-1')).toBe(50);
    });

    it('setThreshold() with a channelId overrides only that channel', () => {
      const { relay } = makeFakes();
      relay.setThreshold(40, 'ch-1');
      expect(relay.getThreshold('ch-1')).toBe(40);
      expect(relay.getThreshold('ch-2')).toBe(70);
      expect(relay.getThreshold()).toBe(70);
    });
  });

  describe('onContextUsage() triggering', () => {
    it('does not relay below threshold', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(69));
      expect(sendUserMessage).not.toHaveBeenCalled();
    });

    it('starts a relay at/above threshold', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(70));
      expect(sendUserMessage).toHaveBeenCalledWith('ch-1', HANDOFF_SYSTEM_PROMPT);
    });

    it('does not relay a channel that was never registered via registerLaunch', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.onContextUsage('unknown-ch', usage(99));
      expect(sendUserMessage).not.toHaveBeenCalled();
    });

    it('defers when a control request is pending for that channel', () => {
      const { relay, sendUserMessage, hasPending } = makeFakes();
      hasPending.mockReturnValue(true);
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(90));
      expect(sendUserMessage).not.toHaveBeenCalled();
    });

    it('is re-entrancy safe: a second onContextUsage call mid-relay is a no-op', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(90)); // starts relay, sendUserMessage called once, then awaits capture
      relay.onContextUsage('ch-1', usage(91)); // fires while still awaiting — must not re-enter
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('full relay sequence', () => {
    it('captures the handoff text, swaps with resume stripped, and reseeds the new process', async () => {
      const { relay, processManager, sendUserMessage, swapChannel, broadcastMessage } = makeFakes();
      relay.registerLaunch('ch-1', { resume: 'old-sess', permissionMode: 'acceptEdits' }, '/work');

      relay.onContextUsage('ch-1', usage(80));
      expect(sendUserMessage).toHaveBeenNthCalledWith(1, 'ch-1', HANDOFF_SYSTEM_PROMPT);

      // Old process answers the handoff prompt.
      relay.handleStreamEvent('ch-1', {
        type: 'result', subtype: 'success', result: 'HANDOFF SUMMARY', session_id: 'old-sess-id',
      });
      await vi.waitFor(() => expect(swapChannel).toHaveBeenCalled());

      expect(swapChannel).toHaveBeenCalledWith(
        'ch-1',
        { permissionMode: 'acceptEdits', resume: undefined },
        '/work',
      );

      await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(2));
      expect(sendUserMessage).toHaveBeenNthCalledWith(2, 'ch-1', 'HANDOFF SUMMARY');

      // New process answers the reseed turn.
      relay.handleStreamEvent('ch-1', {
        type: 'result', subtype: 'success', result: 'ack', session_id: 'new-sess-id',
      });

      await vi.waitFor(() =>
        expect(broadcastMessage).toHaveBeenCalledWith({
          type: 'relay_started',
          channelId: 'ch-1',
          fromSessionId: 'old-sess-id',
          toSessionId: 'new-sess-id',
        }),
      );

      expect(processManager.swapChannel).toHaveBeenCalledTimes(1);
    });

    it('gives up (no swap) if the handoff turn errors instead of succeeding', async () => {
      const { relay, swapChannel, logger } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));

      relay.handleStreamEvent('ch-1', { type: 'result', subtype: 'error', is_error: true });

      await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
      expect(swapChannel).not.toHaveBeenCalled();
    });

    it('handleStreamEvent() for a channel with no pending capture is a no-op', () => {
      const { relay } = makeFakes();
      expect(() =>
        relay.handleStreamEvent('ch-1', { type: 'result', subtype: 'success', result: 'x' }),
      ).not.toThrow();
    });

    it('a relay is retryable after a failed attempt (relaying flag is released)', async () => {
      const { relay, sendUserMessage, logger } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));
      relay.handleStreamEvent('ch-1', { type: 'result', subtype: 'error' });
      await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());

      relay.onContextUsage('ch-1', usage(80));
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('unregisterChannel()', () => {
    it('clears launch info so a later onContextUsage cannot relay it', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.unregisterChannel('ch-1');
      relay.onContextUsage('ch-1', usage(99));
      expect(sendUserMessage).not.toHaveBeenCalled();
    });

    it('clears a per-channel threshold override', () => {
      const { relay } = makeFakes();
      relay.setThreshold(10, 'ch-1');
      relay.unregisterChannel('ch-1');
      expect(relay.getThreshold('ch-1')).toBe(70);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/relay/SessionRelayManager.test.ts`
Expected: FAIL — `Cannot find module '../../../src/relay/SessionRelayManager'`

- [ ] **Step 3: Implement `SessionRelayManager`**

Create `src/relay/SessionRelayManager.ts`:

```typescript
import type { ProcessLaunchOptions } from '../process/ClaudeProcessManager';
import type { ILogger } from '../process/ClaudeProcessManager';
import type { ContextUsage } from '../types/ipc';
import type { ClaudeStreamEvent } from '../types/process';
import { HANDOFF_SYSTEM_PROMPT } from './handoffPrompt';

const DEFAULT_THRESHOLD = 70;

export interface IRelayProcessManager {
  sendUserMessage(channelId: string, text: string): void;
  swapChannel(channelId: string, options: ProcessLaunchOptions, cwd?: string): Promise<void>;
}

export interface IRelayControlRequestManager {
  hasPending(channelId: string): boolean;
}

export interface IRelayViewManager {
  broadcastMessage(msg: {
    type: 'relay_started';
    channelId: string;
    fromSessionId?: string;
    toSessionId?: string;
  }): void;
}

interface LaunchInfo {
  options: ProcessLaunchOptions;
  cwd?: string;
}

interface CapturedResult {
  text: string;
  sessionId?: string;
}

interface PendingCapture {
  resolve: (result: CapturedResult) => void;
  reject: (err: Error) => void;
}

/**
 * Watches per-channel context usage and, once a channel crosses its relay
 * threshold, swaps that channel to a fresh claude process seeded with a
 * distilled handoff — pre-empting context rot instead of reacting to it.
 * See docs/session-relay-design.md for the full design.
 */
export class SessionRelayManager {
  private readonly launches = new Map<string, LaunchInfo>();
  private readonly thresholds = new Map<string, number>();
  private readonly relaying = new Set<string>();
  private readonly pendingCaptures = new Map<string, PendingCapture>();
  private defaultThreshold = DEFAULT_THRESHOLD;

  constructor(
    private readonly processManager: IRelayProcessManager,
    private readonly control: IRelayControlRequestManager,
    private readonly viewManager: IRelayViewManager,
    private readonly logger: ILogger,
  ) {}

  /** Record how a channel was launched, so a later relay knows how to respawn it. */
  registerLaunch(channelId: string, options: ProcessLaunchOptions, cwd?: string): void {
    this.launches.set(channelId, { options, cwd });
  }

  /** Forget a channel entirely — called when the channel is explicitly closed. */
  unregisterChannel(channelId: string): void {
    this.launches.delete(channelId);
    this.thresholds.delete(channelId);
    this.relaying.delete(channelId);
    const pending = this.pendingCaptures.get(channelId);
    if (pending) {
      this.pendingCaptures.delete(channelId);
      pending.reject(new Error(`channel "${channelId}" closed`));
    }
  }

  getThreshold(channelId?: string): number {
    if (channelId === undefined) return this.defaultThreshold;
    return this.thresholds.get(channelId) ?? this.defaultThreshold;
  }

  setThreshold(threshold: number, channelId?: string): void {
    if (channelId === undefined) {
      this.defaultThreshold = threshold;
    } else {
      this.thresholds.set(channelId, threshold);
    }
  }

  /** Called for every context_usage refresh; starts a relay once past threshold. */
  onContextUsage(channelId: string, usage: ContextUsage): void {
    if (!this.launches.has(channelId)) return;
    if (usage.percentage < this.getThreshold(channelId)) return;
    void this.relay(channelId);
  }

  /**
   * Called by MessageBroker for every `result` stream event on a channel.
   * Only meaningful while a relay has a capture pending for that channel —
   * a no-op the rest of the time.
   */
  handleStreamEvent(channelId: string, event: ClaudeStreamEvent): void {
    if (event.type !== 'result') return;
    const pending = this.pendingCaptures.get(channelId);
    if (!pending) return;
    this.pendingCaptures.delete(channelId);

    const sessionId = typeof event.session_id === 'string' ? event.session_id : undefined;
    if (event.subtype === 'success' && typeof event.result === 'string') {
      pending.resolve({ text: event.result, sessionId });
    } else {
      pending.reject(new Error(`relay turn did not succeed (subtype=${String(event.subtype)})`));
    }
  }

  private captureNextResult(channelId: string): Promise<CapturedResult> {
    return new Promise((resolve, reject) => {
      this.pendingCaptures.set(channelId, { resolve, reject });
    });
  }

  private async relay(channelId: string): Promise<void> {
    if (this.relaying.has(channelId)) return;
    if (this.control.hasPending(channelId)) return;
    const launch = this.launches.get(channelId);
    if (!launch) return;

    this.relaying.add(channelId);
    try {
      const handoffCapture = this.captureNextResult(channelId);
      this.processManager.sendUserMessage(channelId, HANDOFF_SYSTEM_PROMPT);
      const handoff = await handoffCapture;

      const freshOptions: ProcessLaunchOptions = { ...launch.options, resume: undefined };
      await this.processManager.swapChannel(channelId, freshOptions, launch.cwd);

      const reseedCapture = this.captureNextResult(channelId);
      this.processManager.sendUserMessage(channelId, handoff.text);
      const reseeded = await reseedCapture;

      this.viewManager.broadcastMessage({
        type: 'relay_started',
        channelId,
        fromSessionId: handoff.sessionId,
        toSessionId: reseeded.sessionId,
      });
    } catch (err) {
      this.logger.error(`[SessionRelayManager] relay failed for channel "${channelId}"`, err);
    } finally {
      this.relaying.delete(channelId);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/relay/SessionRelayManager.test.ts`
Expected: PASS — all tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/relay/SessionRelayManager.ts test/unit/relay/SessionRelayManager.test.ts
git commit -m "feat(relay): add SessionRelayManager core orchestrator"
```

---

### Task 7: Wire `SessionRelayManager` into `MessageBroker`

**Files:**
- Modify: `src/ipc/MessageBroker.ts`
- Test: `test/unit/ipc/MessageBroker.test.ts`
- Check: `test/helpers/ipcTestHarness.ts` (read, do not need to modify — confirms the harness shape before writing tests)

- [ ] **Step 1: Read the test harness to confirm its shape**

Run: `sed -n '1,80p' test/helpers/ipcTestHarness.ts`

Confirm `createIpcTestHarness()` returns `{ processManager, sessionManager, diffManager, viewManager, channelRouter, webview, logger, dispatch, postedMessages }` matching the constructor args used in `test/unit/ipc/MessageBroker.test.ts`'s `makebroker()`. If the shape differs from this plan's assumption, adjust the test code in Step 2 to match — the harness is the source of truth, not this plan.

- [ ] **Step 2: Write the failing tests**

Add to `test/unit/ipc/MessageBroker.test.ts`:

```typescript
import { HANDOFF_SYSTEM_PROMPT } from '../../../src/relay/handoffPrompt';

function makeBrokerWithRelay() {
  const h = createIpcTestHarness();
  const sessionRelayManager = {
    registerLaunch: vi.fn(),
    unregisterChannel: vi.fn(),
    onContextUsage: vi.fn(),
    handleStreamEvent: vi.fn(),
    getThreshold: vi.fn(() => 70),
    setThreshold: vi.fn(),
  };
  const broker = new MessageBroker(
    h.processManager,
    h.sessionManager,
    h.diffManager,
    h.viewManager,
    h.channelRouter,
    h.webview,
    h.logger,
    { sessionRelayManager },
  );
  return { h, broker, sessionRelayManager };
}

describe('SessionRelayManager wiring', () => {
  it('launch_claude registers the launch with SessionRelayManager', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    h.dispatch({ type: 'launch_claude', channelId: 'ch-1', cwd: '/work', permissionMode: 'acceptEdits' });
    expect(sessionRelayManager.registerLaunch).toHaveBeenCalledWith(
      'ch-1',
      expect.objectContaining({ permissionMode: 'acceptEdits' }),
      '/work',
    );
  });

  it('close_channel unregisters the channel from SessionRelayManager', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    h.dispatch({ type: 'close_channel', channelId: 'ch-1' });
    expect(sessionRelayManager.unregisterChannel).toHaveBeenCalledWith('ch-1');
  });

  it('a result event is forwarded to SessionRelayManager.handleStreamEvent', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
    const routed = h.channelRouter.register.mock.calls[0][1] as (event: unknown) => void;

    routed({ type: 'result', subtype: 'success', result: 'x' });

    expect(sessionRelayManager.handleStreamEvent).toHaveBeenCalledWith('ch-1', {
      type: 'result', subtype: 'success', result: 'x',
    });
  });

  it('get_context_usage refresh forwards usage to SessionRelayManager.onContextUsage', async () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    // A real get_context_usage round-trip requires the channel's control_response
    // to come back through the same channelRouter handler handleLaunchClaude
    // registers — so launch first to capture that handler.
    h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
    const routed = h.channelRouter.register.mock.calls[0][1] as (event: unknown) => void;

    h.dispatch({ type: 'get_context_usage', channelId: 'ch-1' });

    // ControlRequestManager wrote the control_request to processManager.writeToChannel;
    // pull the request_id it generated so the response we feed back matches it.
    const writeCall = h.processManager.writeToChannel.mock.calls.find(
      ([, data]) => (data as { request?: { subtype?: string } }).request?.subtype === 'get_context_usage',
    );
    expect(writeCall).toBeDefined();
    const requestId = (writeCall![1] as { request_id: string }).request_id;

    routed({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { maxTokens: 100_000, totalTokens: 80_000, percentage: 80, categories: [] },
      },
    });

    await vi.waitFor(() =>
      expect(sessionRelayManager.onContextUsage).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ percentage: 80 }),
      ),
    );
  });

  it('get_relay_threshold posts the current threshold', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    h.dispatch({ type: 'get_relay_threshold', channelId: 'ch-1' });
    expect(sessionRelayManager.getThreshold).toHaveBeenCalledWith('ch-1');
    expect(h.postedMessages).toContainEqual({ type: 'relay_threshold', channelId: 'ch-1', threshold: 70 });
  });

  it('set_relay_threshold updates and echoes back the new threshold', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    sessionRelayManager.getThreshold.mockReturnValue(55);
    h.dispatch({ type: 'set_relay_threshold', threshold: 55, channelId: 'ch-1' });
    expect(sessionRelayManager.setThreshold).toHaveBeenCalledWith(55, 'ch-1');
    expect(h.postedMessages).toContainEqual({ type: 'relay_threshold', channelId: 'ch-1', threshold: 55 });
  });

  it('falls back to a real SessionRelayManager when none is injected', () => {
    const { h } = makebroker();
    expect(() => h.dispatch({ type: 'get_relay_threshold' })).not.toThrow();
    expect(h.postedMessages).toContainEqual({ type: 'relay_threshold', channelId: undefined, threshold: 70 });
  });
});
```

> **Note for the implementing agent:** the `get_context_usage` test above deliberately references "whatever helper those tests use" — open `test/unit/ipc/MessageBroker.test.ts` and find the existing `describe('get_context_usage', ...)` block before writing this test, then mirror its exact control-response-settling mechanism instead of guessing. Replace the placeholder comment with real code before treating this step as done — an unresolved placeholder here is a plan failure, not an acceptable shortcut.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/unit/ipc/MessageBroker.test.ts -t "SessionRelayManager wiring"`
Expected: FAIL — `services.sessionRelayManager` has no effect yet; `registerLaunch`/`unregisterChannel`/etc. never called; `get_relay_threshold`/`set_relay_threshold` hit the `default:` unhandled-message-type branch.

- [ ] **Step 4: Implement the wiring**

In `src/ipc/MessageBroker.ts`:

Add the import (near the other relative imports at the top):

```typescript
import { SessionRelayManager, type IRelayProcessManager, type IRelayControlRequestManager, type IRelayViewManager } from '../relay/SessionRelayManager';
```

Add the `ISessionRelayManager` interface next to the other `I*` interfaces (after `IViewManager`):

```typescript
export interface ISessionRelayManager {
  registerLaunch(channelId: string, options: ProcessLaunchOptions, cwd?: string): void;
  unregisterChannel(channelId: string): void;
  onContextUsage(channelId: string, usage: import('../types/ipc').ContextUsage): void;
  handleStreamEvent(channelId: string, event: ClaudeStreamEvent): void;
  getThreshold(channelId?: string): number;
  setThreshold(threshold: number, channelId?: string): void;
}
```

Add it as an optional service on `MessageBrokerServices`:

```typescript
export interface MessageBrokerServices {
  authManager?: IAuthManager;
  worktreeManager?: IWorktreeManager;
  atMentionHandler?: IAtMentionHandler;
  fileListProvider?: IFileListProvider;
  vscode?: IVSCodeBridge;
  terminalLauncher?: ITerminalLauncher;
  commandRunner?: ICommandRunner;
  sessionRelayManager?: ISessionRelayManager;
}
```

Add a private field and construct it in the constructor, right after `this.control` is created:

```typescript
  private readonly control: ControlRequestManager;
  private readonly sessionRelayManager: ISessionRelayManager;
```

```typescript
    this.control = new ControlRequestManager((channelId, data) =>
      this.processManager.writeToChannel(channelId, data),
    );
    this.sessionRelayManager =
      this.services.sessionRelayManager ??
      new SessionRelayManager(
        this.processManager as IRelayProcessManager,
        this.control as IRelayControlRequestManager,
        this.viewManager as IRelayViewManager,
        this.logger,
      );
```

Update `refreshContextUsage()` to also notify the relay manager:

```typescript
  private async refreshContextUsage(channelId: string): Promise<void> {
    try {
      const response = await this.control.send(channelId, 'get_context_usage');
      const usage = parseContextUsage(response);
      if (usage) {
        this.viewManager.broadcastMessage({ type: 'context_usage', channelId, usage });
        this.sessionRelayManager.onContextUsage(channelId, usage);
      }
    } catch (err) {
      this.logger.info(`[MessageBroker] get_context_usage failed: ${String(err)}`);
    }
  }
```

Update the `channelRouter.register` handler inside `handleLaunchClaude()` to forward result events:

```typescript
    this.channelRouter.register(channelId, (event) => {
      const typed = event as { type?: string };
      if (typed.type === 'control_response') {
        this.control.handleResponse(event as ControlResponseEvent);
        return;
      }
      this.viewManager.broadcastMessage({
        type: 'request',
        channelId,
        requestId: channelId,
        request: event as ClaudeStreamEvent,
      });
      if (typed.type === 'result') {
        this.sessionRelayManager.handleStreamEvent(channelId, event as ClaudeStreamEvent);
        void this.refreshContextUsage(channelId);
      }
    });
```

Register the launch — add this line right after `const options: ProcessLaunchOptions = {...}` is built in `handleLaunchClaude()`, before the `channelRouter.register` call:

```typescript
    this.sessionRelayManager.registerLaunch(channelId, options, msg.cwd);
```

Unregister on close — add to `handleCloseChannel()`:

```typescript
  private handleCloseChannel(msg: Extract<FromWebviewMessage, { type: 'close_channel' }>): void {
    this.processManager.closeChannel(msg.channelId);
    this.control.dispose();
    this.sessionRelayManager.unregisterChannel(msg.channelId);
    void this.sessionManager.updateSession(msg.channelId, 'idle');
    this.viewManager.broadcastSessionStates();
  }
```

Add the two new message-type cases to the `handleMessage()` switch, right after the existing `case 'get_context_usage':` block:

```typescript
        case 'get_relay_threshold': {
          const threshold = this.sessionRelayManager.getThreshold(msg.channelId);
          void this.webview.postMessage({ type: 'relay_threshold', channelId: msg.channelId, threshold });
          return;
        }
        case 'set_relay_threshold': {
          this.sessionRelayManager.setThreshold(msg.threshold, msg.channelId);
          const threshold = this.sessionRelayManager.getThreshold(msg.channelId);
          void this.webview.postMessage({ type: 'relay_threshold', channelId: msg.channelId, threshold });
          return;
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/ipc/MessageBroker.test.ts`
Expected: PASS — full file, including all pre-existing tests and the new wiring block.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npx vitest run test/unit test/integration && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/ipc/MessageBroker.ts test/unit/ipc/MessageBroker.test.ts
git commit -m "feat(ipc): wire SessionRelayManager into MessageBroker launch/usage/close/threshold paths"
```

---

### Task 8: Webview — surface `relay_started` in transcript state

**Files:**
- Modify: `webview-src/store/sessionStore.ts`
- Test: `webview-src/store/sessionStore.test.ts`

Per the design doc's stated non-goals, this task deliberately does NOT add any rendering — it only makes sure a `relay_started` broadcast is captured into state as a synthetic transcript event, so a future UI pass has something to key off of instead of the message being silently dropped.

- [ ] **Step 1: Write the failing test**

Add to `webview-src/store/sessionStore.test.ts`:

```typescript
  test('relay_started is recorded as a relay_marker event in the channel transcript', () => {
    const { result } = renderHook(() => useSessionReducer());

    act(() => {
      result.current.handleMessage({
        type: 'relay_started',
        channelId: 'c1',
        fromSessionId: 'old-sess',
        toSessionId: 'new-sess',
      });
    });

    expect(result.current.state.channels.c1.events).toEqual([
      { type: 'relay_marker', fromSessionId: 'old-sess', toSessionId: 'new-sess' },
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run webview-src/store/sessionStore.test.ts -t "relay_started"`
Expected: FAIL — `state.channels.c1` is `undefined` (the message is silently ignored today).

- [ ] **Step 3: Implement the handling**

In `webview-src/store/sessionStore.ts`, in `handleMessage`, add a branch before the existing `if (msg.type === 'context_usage')` check:

```typescript
      if (msg.type === 'relay_started') {
        dispatch({
          type: 'STREAM_EVENT',
          channelId: msg.channelId,
          event: { type: 'relay_marker', fromSessionId: msg.fromSessionId, toSessionId: msg.toSessionId },
        });
        return;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run webview-src/store/sessionStore.test.ts`
Expected: PASS — both the pre-existing tests and the new one.

- [ ] **Step 5: Run the full unit suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add webview-src/store/sessionStore.ts webview-src/store/sessionStore.test.ts
git commit -m "feat(webview): record relay_started as a relay_marker transcript event"
```

---

## Post-implementation

- [ ] Run the full gate: `npx vitest run && npx tsc --noEmit && npx eslint . ` (or this repo's equivalent lint command — check `package.json` scripts if the exact command has drifted from this).
- [ ] Update `docs/session-relay-design.md`'s status line from "proposed, not implemented" to "implemented" with a pointer to this plan and the PR.
- [ ] `bd close session-relay-design-2ne` once the PR is open (not before — the ticket's own convention elsewhere in this repo closes on merge-readiness, verify against `bd show` if unsure).
- [ ] This plan, the design doc status update, and all 8 tasks' commits land in ONE PR from branch `feat/session-relay` — do not split into per-task PRs.

## Explicitly deferred (not in this plan, per the design doc's non-goals)

- UI rendering of the `relay_marker` event (currently just captured in state, Task 8).
- Persisting per-channel threshold overrides across a channel restart (currently in-memory only, lost on `unregisterChannel`/extension reload).
- A UI control for changing the threshold (the IPC messages exist; no webview component sends them yet).
- The design doc's suggested end-to-end integration test ("start a relay-eligible channel, issue a tool call that requires approval, fire a relay trigger mid-prompt, assert the relay defers") — Task 6's unit tests cover the `hasPending()` defer branch with a fake, but nothing in this plan exercises it against a real spawned process in `test/integration/`. Worth a follow-up ticket once the feature has real usage to justify the added test infra.
