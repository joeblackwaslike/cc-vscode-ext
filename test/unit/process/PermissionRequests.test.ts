import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PermissionRequests,
  isCanUseToolRequest,
  type CanUseToolEvent,
} from '../../../src/process/PermissionRequests';
import type { PermissionDecision, ToWebviewMessage } from '../../../src/types/ipc';

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
    const post = vi.fn();
    perms.replayTo(post);
    expect(post).not.toHaveBeenCalled();
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
    const post = vi.fn();
    perms.replayTo(post);
    expect(post).toHaveBeenCalledTimes(1);
    expect((post.mock.calls[0][0] as ToWebviewMessage).type).toBe('permission_request');

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
    const post = vi.fn();
    perms.replayTo(post);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('replayTo posts every pending request', () => {
    perms.register('a', ask);
    perms.register('b', exitPlan);
    const post = vi.fn();
    perms.replayTo(post);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('ExitPlanMode requests carry the mode in effect before plan', () => {
    perms.noteMode('c', 'auto');
    perms.noteMode('c', 'plan');
    perms.noteMode('c', 'plan');
    expect(perms.register('c', exitPlan).priorMode).toBe('auto');
    expect(perms.register('c', ask).priorMode).toBeUndefined();
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

  it('isCanUseToolRequest rejects control_response and other subtypes', () => {
    expect(isCanUseToolRequest(ask)).toBe(true);
    expect(isCanUseToolRequest({ type: 'control_response', response: {} })).toBe(false);
    expect(
      isCanUseToolRequest({ type: 'control_request', request_id: 'x', request: { subtype: 'interrupt' } }),
    ).toBe(false);
    expect(isCanUseToolRequest(null)).toBe(false);
  });
});
