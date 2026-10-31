import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import fixture from '../../lib/__fixtures__/permission-protocol.json';
import type { PermissionRequest } from '../../lib/ipc';
import { postMessage } from '../../lib/ipc';
import { ASK_DECLINE_MESSAGE, KEEP_PLANNING_MESSAGE } from '../../lib/permissions';
import { SessionContext, useSessionReducer } from '../../store/sessionStore';
import { PermissionDock } from './PermissionDock';

vi.mock('../../lib/ipc', async () => ({
  ...(await vi.importActual<typeof import('../../lib/ipc')>('../../lib/ipc')),
  postMessage: vi.fn(),
}));

function makeRequest(toolName: string, input: Record<string, unknown> = {}, requestId = 'req'): PermissionRequest {
  return {
    channelId: 'ch',
    requestId,
    toolName,
    input,
    toolUseId: `tu-${requestId}`,
    suggestions: undefined,
    description: undefined,
    priorMode: undefined,
  };
}

function setup(requests: PermissionRequest[]) {
  const hook = renderHook(() => useSessionReducer());
  act(() => { for (const request of requests) hook.result.current.dispatch({ type: 'PERMISSION_ADDED', request }); });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionContext.Provider value={hook.result.current}>{children}</SessionContext.Provider>
  );
  render(<PermissionDock channelId="ch" />, { wrapper });
  return userEvent.setup({ delay: null });
}

beforeEach(() => { vi.mocked(postMessage).mockClear(); });

describe('PermissionDock', () => {
  test('renders nothing without a provider', () => {
    const { container } = render(<PermissionDock channelId="ch" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing with no pending requests', () => {
    setup([]);
    expect(screen.queryByTestId('permission-dock')).toBeNull();
  });

  test('ExitPlanMode renders plan approval and posts the decision', async () => {
    const user = setup([makeRequest('ExitPlanMode', { plan: '# P' })]);
    expect(screen.getByText('Accept this plan?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Yes, and manually approve edits/ }));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'permission_response',
      channelId: 'ch',
      requestId: 'req',
      decision: expect.objectContaining({ behavior: 'allow' }),
    });
  });

  test('unknown tool renders the generic card; Allow once echoes input', async () => {
    const user = setup([makeRequest('Bash', { command: 'ls' })]);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'permission_response',
      channelId: 'ch',
      requestId: 'req',
      decision: { behavior: 'allow', updatedInput: { command: 'ls' } },
    });
  });

  test('generic Deny posts a deny decision', async () => {
    const user = setup([makeRequest('Bash', { command: 'ls' })]);
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ decision: { behavior: 'deny', message: 'User denied permission' } }),
    );
  });

  test('shows only the oldest pending request', () => {
    setup([makeRequest('Bash', { command: 'first' }, 'a'), makeRequest('Write', { file_path: '/x/second.ts' }, 'b')]);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.queryByText('Write')).toBeNull();
  });

  test('AskUserQuestion renders the form and Esc declines', async () => {
    const req = fixture.askControlRequest.request;
    const user = setup([makeRequest('AskUserQuestion', req.input as Record<string, unknown>)]);
    expect(screen.getAllByRole('tab').length).toBeGreaterThan(0);
    await user.keyboard('{Escape}');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ decision: { behavior: 'deny', message: ASK_DECLINE_MESSAGE } }),
    );
  });

  test('Esc on ExitPlanMode keeps planning with the typed feedback', async () => {
    const user = setup([makeRequest('ExitPlanMode', { plan: '# P' })]);
    await user.type(screen.getByRole('textbox'), 'hm');
    await user.keyboard('{Escape}');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ decision: { behavior: 'deny', message: `${KEEP_PLANNING_MESSAGE}\n\nhm` } }),
    );
  });

  test('Esc on a generic tool denies', async () => {
    const user = setup([makeRequest('Bash', { command: 'ls' })]);
    await user.keyboard('{Escape}');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ decision: { behavior: 'deny', message: 'User denied permission' } }),
    );
  });
});
