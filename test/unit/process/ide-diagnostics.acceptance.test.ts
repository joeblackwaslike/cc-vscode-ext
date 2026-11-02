import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';
import { MessageBroker } from '../../../src/ipc/MessageBroker';
import { EditorContextTracker, execFileCode } from '../../../src/context/EditorContextTracker';
import { createDiagnosticsCollector } from '../../../src/ide/diagnostics';
import { createIpcTestHarness } from '../../helpers/ipcTestHarness';

const RUN = process.env.CLAUDE_ACCEPTANCE === '1';
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const TOOL = 'mcp__claude-vscode__getDiagnostics';
const ONE_CALL = ` Call ${TOOL} exactly once with no arguments. Do not use any other tools.`;

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

interface Seed {
  path: string;
  message: string;
}

interface Outcome {
  reply: string;
  written: string;
  toolUses: string[];
  permissionAsks: string[];
}

interface BroadcastMessage {
  type: string;
  request: {
    toolName: string;
    requestId: string;
    input?: Record<string, unknown>;
    type?: string;
    result?: string;
    message?: { content?: { type: string; name?: string }[] };
  };
}

function seedDiagnostics(seeds: Seed[]): void {
  mockVscode.languages.getDiagnostics.mockImplementation(((uri?: { toString(): string }) => {
    const entries = seeds.map(({ path, message }) => [
      mockVscode.Uri.file(path),
      [{ message, severity: 0, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, source: 'probe' }],
    ]);
    if (uri === undefined) return entries;
    const hit = entries.find(([u]) => (u as { toString(): string }).toString() === uri.toString());
    return hit ? hit[1] : [];
  }) as never);
}

async function askThroughBroker(
  text: string,
  cwd: string,
  permissionMode: 'bypassPermissions' | 'default',
  approve: boolean
): Promise<Outcome> {
  const router = new ChannelRouter();
  const logger = { info() {}, warn() {}, error() {} };
  const pm = new ClaudeProcessManager(() => Promise.resolve(CLAUDE_BIN), router, logger);
  const write = vi.spyOn(pm, 'writeToChannel');
  const tracker = new EditorContextTracker({
    settings: { getAttachOpenFile: () => true, getAttachSelection: () => true, getRespectGitIgnore: () => true },
    exec: execFileCode,
    onChange: () => {},
  });
  const h = createIpcTestHarness();
  new MessageBroker(
    pm as never,
    h.sessionManager as never,
    h.diffManager as never,
    h.viewManager as never,
    router as never,
    h.webview as never,
    logger,
    {
      shouldAllowBypass: () => true,
      collectDiagnostics: createDiagnosticsCollector({ isWithheld: (u) => tracker.isWithheld(u) }),
    }
  );
  const outcome: Outcome = { reply: '', written: '', toolUses: [], permissionAsks: [] };
  let done = false;
  h.viewManager.broadcastMessage.mockImplementation((raw: unknown) => {
    const m = raw as BroadcastMessage;
    if (m.type === 'permission_request') {
      outcome.permissionAsks.push(m.request.toolName);
      if (approve) {
        h.dispatch({
          type: 'permission_response',
          channelId: 'ch',
          requestId: m.request.requestId,
          decision: { behavior: 'allow', updatedInput: m.request.input ?? {} },
        } as never);
      }
      return;
    }
    if (m.type !== 'request') return;
    const e = m.request;
    if (e.type === 'assistant') {
      for (const block of e.message?.content ?? []) {
        if (block.type === 'tool_use' && block.name) outcome.toolUses.push(block.name);
      }
    }
    if (e.type === 'result') {
      outcome.reply = e.result ?? '';
      done = true;
    }
  });
  h.dispatch({ type: 'launch_claude', channelId: 'ch', cwd, permissionMode, model: 'haiku' } as never);
  try {
    h.dispatch({ type: 'control_request', channelId: 'ch', requestId: 'r1', text });
    await waitFor(() => done, 100000);
    outcome.written = JSON.stringify(write.mock.calls);
    return outcome;
  } finally {
    tracker.dispose();
    pm.closeChannel('ch');
  }
}

function makeRepo(ignore?: string): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'ide-diagnostics-')));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  if (ignore) writeFileSync(join(repo, '.gitignore'), `${ignore}\n`);
  return repo;
}

describe.skipIf(!RUN)('getDiagnostics through the real MessageBroker and CLI (CLAUDE_ACCEPTANCE)', () => {
  const repos: string[] = [];

  afterEach(() => {
    mockVscode.languages.getDiagnostics.mockImplementation((() => []) as never);
  });

  afterAll(() => {
    for (const repo of repos) rmSync(repo, { recursive: true, force: true });
  });

  it('model calls getDiagnostics and reports a seeded diagnostic', async () => {
    const repo = makeRepo();
    repos.push(repo);
    writeFileSync(join(repo, 'a.ts'), 'const a = 1;\n');
    seedDiagnostics([{ path: join(repo, 'a.ts'), message: 'zzDiagMarker is undefined' }]);
    const out = await askThroughBroker(
      `Fetch the IDE diagnostics and reply with only the unique marker word that starts with zz from the diagnostic message.${ONE_CALL}`,
      repo,
      'bypassPermissions',
      false
    );
    console.log('seeded reply:', JSON.stringify(out.reply), 'toolUses:', out.toolUses);
    expect(out.toolUses).toContain(TOOL);
    expect(out.reply).toContain('zzDiagMarker');
  }, 120000);

  it('a seeded diagnostic in a git-ignored file never reaches the model or the tool result', async () => {
    const repo = makeRepo('secret.ts');
    repos.push(repo);
    writeFileSync(join(repo, 'secret.ts'), 'const s = 1;\n');
    writeFileSync(join(repo, 'open.ts'), 'const o = 1;\n');
    seedDiagnostics([
      { path: join(repo, 'secret.ts'), message: 'zzIgnoredMarker leaked' },
      { path: join(repo, 'open.ts'), message: 'zzVisibleMarker shown' },
    ]);
    const out = await askThroughBroker(
      `Fetch the IDE diagnostics and list every diagnostic message you received, verbatim, one per line.${ONE_CALL}`,
      repo,
      'bypassPermissions',
      false
    );
    console.log('withheld reply:', JSON.stringify(out.reply));
    expect(out.toolUses).toContain(TOOL);
    expect(out.written).toContain('zzVisibleMarker');
    expect(out.written).not.toContain('zzIgnoredMarker');
    expect(out.reply).toContain('zzVisibleMarker');
    expect(out.reply).not.toContain('zzIgnoredMarker');
  }, 120000);

  it('in default permission mode the read-only call runs with no permission request', async () => {
    const repo = makeRepo();
    repos.push(repo);
    writeFileSync(join(repo, 'a.ts'), 'const a = 1;\n');
    seedDiagnostics([{ path: join(repo, 'a.ts'), message: 'zzDefaultMarker is undefined' }]);
    const out = await askThroughBroker(
      `Fetch the IDE diagnostics and reply with only the unique marker word that starts with zz from the diagnostic message.${ONE_CALL}`,
      repo,
      'default',
      true
    );
    console.log('default-mode asks:', out.permissionAsks, 'reply:', JSON.stringify(out.reply));
    expect(out.toolUses).toContain(TOOL);
    expect(out.permissionAsks).toEqual([]);
    expect(out.reply).toContain('zzDefaultMarker');
  }, 120000);
});
