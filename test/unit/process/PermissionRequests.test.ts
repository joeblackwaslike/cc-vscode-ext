import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PermissionRequests,
  isCanUseToolRequest,
  type CanUseToolEvent,
} from '../../../src/process/PermissionRequests';
import type { PermissionDecision } from '../../../src/types/ipc';

const fixtures = JSON.parse(
  readFileSync(join(__dirname, '../../../webview-src/lib/__fixtures__/permission-protocol.json'), 'utf8'),
) as Record<string, CanUseToolEvent>;
const ask = fixtures.askControlRequest;
const exitPlan = fixtures.exitPlanControlRequest;

const allow: PermissionDecision = { behavior: 'allow', updatedInput: { ok: true } };

describe('PermissionRequests', () => {
  let writeOk: boolean;
  let write: ReturnType<typeof vi.fn>;
  let broadcast: ReturnType<typeof vi.fn>;
  let perms: PermissionRequests;

  beforeEach(() => {
    writeOk = true;
    write = vi.fn(() => writeOk);
    broadcast = vi.fn();
    perms = new PermissionRequests({ write, broadcast });
  });

  it('register broadcasts a normalized permission_request', () => {
    const req = perms.register('c', ask);
    expect(req.toolName).toBe('AskUserQuestion');
    expect(req.toolUseId).toBe(ask.request.tool_use_id);
    expect((req.input.questions as unknown[]).length).toBe(2);
    expect(broadcast).toHaveBeenCalledWith({ type: 'permission_request', request: req });
  });

  it('respond writes the control_response shape and broadcasts permission_resolved', () => {
    perms.register('c', ask);
    expect(perms.respond('c', ask.request_id, allow)).toBe(true);
    expect(write).toHaveBeenCalledWith('c', {
      type: 'control_response',
      response: { subtype: 'success', request_id: ask.request_id, response: allow },
    });
    expect(broadcast).toHaveBeenLastCalledWith({
      type: 'permission_resolved',
      channelId: 'c',
      requestId: ask.request_id,
      toolUseId: ask.request.tool_use_id,
      decision: allow,
    });
  });

  it('logs an unknown reply, a dropped reply and a dropped auto-deny', () => {
    const log = vi.fn();
    const logged = new PermissionRequests({ write, broadcast, log });

    expect(logged.respond('c', 'nope', allow)).toBe(false);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('no pending request nope'));

    logged.register('c', ask);
    writeOk = false;
    expect(logged.respond('c', ask.request_id, allow)).toBe(false);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('was dropped'));

    logged.denyWithoutPrompt('c', ask, 'busy');
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('auto-deny'));
  });

  it('tells the user when a reply never reached the CLI', () => {
    const reportError = vi.fn();
    const reporting = new PermissionRequests({ write, broadcast, reportError });
    reporting.register('c', ask);
    writeOk = false;

    expect(reporting.respond('c', ask.request_id, allow)).toBe(false);

    expect(reportError).toHaveBeenCalledWith('c', expect.stringContaining('could not be sent'));
  });

  it('respond returns false for an unknown or already-answered request', () => {
    expect(perms.respond('c', 'nope', allow)).toBe(false);
    perms.register('c', ask);
    expect(perms.respond('c', ask.request_id, allow)).toBe(true);
    expect(perms.respond('c', ask.request_id, allow)).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('respond cancels instead of resolving when the write is dropped', () => {
    perms.register('c', ask);
    writeOk = false;
    broadcast.mockClear();
    expect(perms.respond('c', ask.request_id, allow)).toBe(false);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: 'permission_cancelled',
      channelId: 'c',
      requestIds: [ask.request_id],
      toolUseIds: [ask.request.tool_use_id],
    });
    expect(perms.pendingFor('c')).toEqual([]);
  });

  it('cancelChannel drops only that channel and broadcasts requestIds and toolUseIds', () => {
    perms.register('a', ask);
    perms.register('b', exitPlan);
    broadcast.mockClear();
    perms.cancelChannel('a');
    expect(broadcast).toHaveBeenCalledWith({
      type: 'permission_cancelled',
      channelId: 'a',
      requestIds: [ask.request_id],
      toolUseIds: [ask.request.tool_use_id],
    });
    expect(perms.pendingFor('a')).toEqual([]);
    expect(perms.pendingFor('b')).toHaveLength(1);

    broadcast.mockClear();
    perms.cancelChannel('a');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('cancel drops one request, broadcasts requestId and toolUseId, ignores unknown ids', () => {
    perms.register('a', ask);
    perms.register('a', exitPlan);
    broadcast.mockClear();
    perms.cancel('a', 'nope');
    expect(broadcast).not.toHaveBeenCalled();
    perms.cancel('a', ask.request_id);
    expect(broadcast).toHaveBeenCalledWith({
      type: 'permission_cancelled',
      channelId: 'a',
      requestIds: [ask.request_id],
      toolUseIds: [ask.request.tool_use_id],
    });
    expect(perms.pendingFor('a')).toHaveLength(1);
  });

  it('pendingFor returns only that channel\'s unanswered requests', () => {
    perms.register('a', ask);
    perms.register('b', exitPlan);
    expect(perms.pendingFor('a').map((r) => r.requestId)).toEqual([ask.request_id]);
    expect(perms.pendingFor('nope')).toEqual([]);
    perms.respond('a', ask.request_id, allow);
    expect(perms.pendingFor('a')).toEqual([]);
  });

  it('ExitPlanMode requests carry the mode in effect before plan', () => {
    perms.noteMode('c', 'auto');
    perms.noteMode('c', 'plan');
    perms.noteMode('c', 'plan');
    expect(perms.register('c', exitPlan).priorMode).toBe('auto');
    expect(perms.register('c', ask).priorMode).toBeUndefined();
  });

  describe('approve mode', () => {
    it('register sets approveMode from getApproveMode for ExitPlanMode', () => {
      const p = new PermissionRequests({ write, broadcast, getApproveMode: () => 'auto' });
      const r = p.register('c', exitPlan);
      expect(r.approveMode).toBe('auto');
      expect(r.approveNotice).toBeUndefined();
    });

    it('falls back to acceptEdits with a notice when bypass was not launched', () => {
      const p = new PermissionRequests({ write, broadcast, getApproveMode: () => 'bypassPermissions' });
      const r = p.register('c', exitPlan);
      expect(r.approveMode).toBe('acceptEdits');
      expect(r.approveNotice).toMatch(/bypass/i);
    });

    it('keeps bypassPermissions when the channel was launched with the flag', () => {
      const p = new PermissionRequests({ write, broadcast, getApproveMode: () => 'bypassPermissions' });
      p.noteBypassAllowed('c', true);
      const r = p.register('c', exitPlan);
      expect(r.approveMode).toBe('bypassPermissions');
      expect(r.approveNotice).toBeUndefined();
    });
  });

  describe('default-mode offer', () => {
    const approve = (mode: string): PermissionDecision => ({
      behavior: 'allow',
      updatedInput: {},
      updatedPermissions: [{ type: 'setMode', mode, destination: 'session' }] as PermissionDecision extends { updatedPermissions?: infer U } ? U : never,
    });
    const offers = () => broadcast.mock.calls.map((c) => c[0]).filter((m) => m.type === 'default_mode_offer');
    const make = (offer: 'off' | 'acceptEdits' | 'auto' | 'bypassPermissions', resolved: 'plan' | 'acceptEdits', approveMode: 'acceptEdits' | 'bypassPermissions' | 'default' = 'acceptEdits') => {
      const p = new PermissionRequests({
        write,
        broadcast,
        getApproveMode: () => (approveMode === 'default' ? 'default' : approveMode) as never,
        getOfferMode: () => offer,
        getResolvedDefault: () => resolved,
      });
      p.noteBypassAllowed('c', true);
      p.register('c', exitPlan);
      return p;
    };

    it('offers the configured mode after option 1 when it differs from the resolved default', () => {
      const p = make('acceptEdits', 'plan');
      p.respond('c', exitPlan.request_id, approve('acceptEdits'));
      expect(offers()).toEqual([{ type: 'default_mode_offer', channelId: 'c', mode: 'acceptEdits', currentDefault: 'plan' }]);
    });

    it('offers exactly once for the bypass/bypass/plan settings', () => {
      const p = make('bypassPermissions', 'plan', 'bypassPermissions');
      p.respond('c', exitPlan.request_id, approve('bypassPermissions'));
      expect(offers()).toEqual([{ type: 'default_mode_offer', channelId: 'c', mode: 'bypassPermissions', currentDefault: 'plan' }]);
    });

    it('emits no offer when the approval was downgraded', () => {
      const p = new PermissionRequests({
        write, broadcast,
        getApproveMode: () => 'bypassPermissions',
        getOfferMode: () => 'bypassPermissions',
        getResolvedDefault: () => 'plan',
      });
      p.register('c', exitPlan);
      p.respond('c', exitPlan.request_id, approve('acceptEdits'));
      expect(offers()).toEqual([]);
    });

    describe('takeOffer', () => {
      it('accepts one answer matching the outstanding offer', () => {
        const p = make('acceptEdits', 'plan');
        p.respond('c', exitPlan.request_id, approve('acceptEdits'));
        expect(p.takeOffer('c', 'acceptEdits')).toBe(true);
        expect(p.takeOffer('c', 'acceptEdits')).toBe(false);
      });

      it('rejects a mismatched mode and keeps the offer outstanding', () => {
        const log = vi.fn();
        const p = new PermissionRequests({
          write, broadcast, log,
          getApproveMode: () => 'acceptEdits',
          getOfferMode: () => 'acceptEdits',
          getResolvedDefault: () => 'plan',
        });
        p.register('c', exitPlan);
        p.respond('c', exitPlan.request_id, approve('acceptEdits'));
        expect(p.takeOffer('c', 'bypassPermissions')).toBe(false);
        expect(log).toHaveBeenCalledWith(expect.stringMatching(/offer/));
        expect(p.takeOffer('d', 'acceptEdits')).toBe(false);
        expect(p.takeOffer('c', 'acceptEdits')).toBe(true);
      });

      it('rejects an answer when no offer was made', () => {
        expect(make('acceptEdits', 'plan').takeOffer('c', 'acceptEdits')).toBe(false);
      });

      it('closeChannel drops the outstanding offer, mode, bypass flag, and pending prompts', () => {
        const p = make('acceptEdits', 'plan');
        p.noteBypassAllowed('c', true);
        p.respond('c', exitPlan.request_id, approve('acceptEdits'));
        p.register('c', ask);
        p.closeChannel('c');
        expect(p.takeOffer('c', 'acceptEdits')).toBe(false);
        expect(p.pendingFor('c')).toEqual([]);
        expect(p.modeOf('c')).toBeUndefined();
        expect(p.bypassAllowed('c')).toBe(false);
      });
    });

    it('treats a default setMode as option 1 when approveMode is default', () => {
      const p = make('acceptEdits', 'plan', 'default');
      p.respond('c', exitPlan.request_id, approve('default'));
      expect(offers()).toHaveLength(1);
    });

    it.each([
      ['the setting is off', () => make('off', 'plan'), approve('acceptEdits')],
      ['modes match', () => make('acceptEdits', 'acceptEdits'), approve('acceptEdits')],
      ['option 2 (manual) was chosen', () => make('acceptEdits', 'plan'), approve('default')],
      ['keep-planning was chosen', () => make('acceptEdits', 'plan'), { behavior: 'deny', message: 'keep' } as PermissionDecision],
    ])('emits no offer when %s', (_name, build, decision) => {
      build().respond('c', exitPlan.request_id, decision);
      expect(offers()).toEqual([]);
    });

    it('emits no offer for non-ExitPlanMode tools or a failed write', () => {
      const p = make('acceptEdits', 'plan');
      p.register('c', ask);
      p.respond('c', ask.request_id, approve('acceptEdits'));
      writeOk = false;
      p.respond('c', exitPlan.request_id, approve('acceptEdits'));
      expect(offers()).toEqual([]);
    });
  });

  it('denyWithoutPrompt writes a deny without broadcasting', () => {
    perms.denyWithoutPrompt('c', ask, 'nope');
    expect(write).toHaveBeenCalledWith('c', {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: ask.request_id,
        response: { behavior: 'deny', message: 'nope' },
      },
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('modeOf returns the last noted mode per channel', () => {
    expect(perms.modeOf('a')).toBeUndefined();
    perms.noteMode('a', 'plan');
    perms.noteMode('b', 'auto');
    expect(perms.modeOf('a')).toBe('plan');
    expect(perms.modeOf('b')).toBe('auto');
  });

  it('bypassAllowed reflects the last noteBypassAllowed', () => {
    expect(perms.bypassAllowed('ch-1')).toBe(false);
    perms.noteBypassAllowed('ch-1', true);
    expect(perms.bypassAllowed('ch-1')).toBe(true);
    perms.noteBypassAllowed('ch-1', false);
    expect(perms.bypassAllowed('ch-1')).toBe(false);
  });

  it('isCanUseToolRequest rejects control_response and other subtypes', () => {
    expect(isCanUseToolRequest(ask)).toBe(true);
    expect(isCanUseToolRequest({ type: 'control_response', response: {} })).toBe(false);
    expect(
      isCanUseToolRequest({ type: 'control_request', request_id: 'x', request: { subtype: 'interrupt' } }),
    ).toBe(false);
    expect(isCanUseToolRequest(null)).toBe(false);
  });
});
