import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';
import { PermissionRequests, isCanUseToolRequest } from '../../../src/process/PermissionRequests';
import { buildExitPlanDecision } from '../../../webview-src/lib/permissions';
import type { ApproveMode } from '../../../src/settings/ExtensionSettings';

const RUN = process.env.CLAUDE_ACCEPTANCE === '1';
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';

interface Probe {
  toolsAfterApproval: string[];
  initModes: unknown[];
  toolUses: string[];
  fileWritten: boolean;
}

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

async function runPlanApproval(approveMode: ApproveMode): Promise<Probe> {
  const cwd = mkdtempSync(join(tmpdir(), 'plan-approval-'));
  const router = new ChannelRouter();
  const logger = { info() {}, warn() {}, error() {} };
  const pm = new ClaudeProcessManager(() => Promise.resolve(CLAUDE_BIN), router, logger);
  const perms = new PermissionRequests({
    write: (ch, data) => pm.writeToChannel(ch, data),
    broadcast() {},
    getApproveMode: () => approveMode,
  });
  perms.noteBypassAllowed('ch', true);

  const probe: Probe = { toolsAfterApproval: [], initModes: [], toolUses: [], fileWritten: false };
  let approved = false;
  let done = false;
  router.register('ch', (raw) => {
    const e = raw as {
      type: string;
      subtype?: string;
      permissionMode?: unknown;
      message?: { content?: { type: string; name?: string }[] };
    };
    if (e.type === 'assistant') {
      for (const block of e.message?.content ?? []) {
        if (block.type === 'tool_use' && block.name) probe.toolUses.push(block.name);
      }
    }
    if (e.type === 'system' && e.subtype === 'init') probe.initModes.push(e.permissionMode);
    if (e.type === 'result') done = true;
    if (!isCanUseToolRequest(e)) return;
    const req = perms.register('ch', e);
    if (e.request.tool_name === 'ExitPlanMode' && !approved) {
      approved = true;
      perms.respond('ch', req.requestId, buildExitPlanDecision('auto', req, ''));
      return;
    }
    if (approved) probe.toolsAfterApproval.push(e.request.tool_name);
    perms.respond('ch', req.requestId, { behavior: 'deny', message: 'probe: not allowed' });
  });

  await pm.spawnClaude(
    'ch',
    { wrapper: CLAUDE_BIN, permissionMode: 'plan', allowDangerouslySkipPermissions: true, model: 'haiku' },
    cwd
  );
  try {
    pm.sendUserMessage(
      'ch',
      'You are in plan mode. Do not use any tool except ExitPlanMode. Immediately call ExitPlanMode with the plan "create probe.txt containing hi, then run node -e 1". ' +
        'After the plan is approved, use the Write tool to create probe.txt containing hi, then use the Bash tool to run exactly: node -e "console.log(42)". Then stop.'
    );
    await waitFor(() => done, 100000);
    probe.fileWritten = existsSync(join(cwd, 'probe.txt'));
    return probe;
  } finally {
    pm.closeChannel('ch');
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe.skipIf(!RUN)('plan approval switches the live session mode (CLAUDE_ACCEPTANCE)', () => {
  it('bypassPermissions: gated tools run with no further permission request', async () => {
    const probe = await runPlanApproval('bypassPermissions');
    console.log('bypass probe', JSON.stringify(probe));
    expect(probe.toolUses).toEqual(expect.arrayContaining(['ExitPlanMode', 'Write', 'Bash']));
    expect(probe.toolsAfterApproval).toEqual([]);
    expect(probe.fileWritten).toBe(true);
  }, 120000);

  it('acceptEdits: Write runs unprompted, Bash still asks', async () => {
    const probe = await runPlanApproval('acceptEdits');
    console.log('acceptEdits probe', JSON.stringify(probe));
    expect(probe.toolUses).toEqual(expect.arrayContaining(['ExitPlanMode', 'Write', 'Bash']));
    expect(probe.fileWritten).toBe(true);
    expect(probe.toolsAfterApproval).not.toContain('Write');
    expect(probe.toolsAfterApproval).toContain('Bash');
  }, 120000);
});
