import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { PermissionMode, PermissionRequest } from '../../lib/ipc';
import { KEEP_PLANNING_MESSAGE } from '../../lib/permissions';
import type { PlanComment } from '../../lib/permissions';
import { PlanApproval } from './PlanApproval';

function makeRequest(priorMode?: PermissionMode): PermissionRequest {
  return {
    channelId: 'ch',
    requestId: 'req',
    toolName: 'ExitPlanMode',
    input: { plan: '# Plan' },
    toolUseId: 'tu1',
    suggestions: undefined,
    description: undefined,
    priorMode,
  };
}

function setup(comments: PlanComment[] = [], priorMode?: PermissionMode) {
  const onDecision = vi.fn();
  const onRemoveComment = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(
    <PlanApproval request={makeRequest(priorMode)} comments={comments} onRemoveComment={onRemoveComment} onDecision={onDecision} />,
  );
  return { onDecision, onRemoveComment, user };
}

describe('PlanApproval', () => {
  test('asks to accept the plan when there are no comments', () => {
    setup();
    expect(screen.getByText('Accept this plan?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No, keep planning/ })).toBeInTheDocument();
  });

  test('shows the comment count and continue-planning heading with comments', () => {
    setup([{ id: 'c1', quote: 'a line', text: 'fix it' }]);
    expect(screen.getByText('Continue planning')).toBeInTheDocument();
    expect(screen.getByText('1 comment will be included as feedback')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send feedback and keep planning/ })).toBeInTheDocument();
  });

  test('shows the select-text hint with no comments', () => {
    setup();
    expect(screen.getByText('Select text in the preview to add comments')).toBeInTheDocument();
  });

  test('replaces the hint with the count when there are comments', () => {
    setup([{ id: 'c1', quote: 'q', text: 't' }]);
    expect(screen.queryByText('Select text in the preview to add comments')).toBeNull();
    expect(screen.getByText('1 comment will be included as feedback')).toBeInTheDocument();
  });

  test('pluralizes the comment count', () => {
    setup([{ id: 'c1', quote: 'q', text: 't' }, { id: 'c2', quote: 'q2', text: 't2' }]);
    expect(screen.getByText('2 comments will be included as feedback')).toBeInTheDocument();
  });

  test('truncates quotes over 80 chars with an ellipsis', () => {
    setup([{ id: 'c1', quote: 'x'.repeat(100), text: 't' }]);
    expect(screen.getByText(`${'x'.repeat(80)}…`)).toBeInTheDocument();
  });

  test('removing a comment calls onRemoveComment with its id', async () => {
    const { onRemoveComment, user } = setup([{ id: 'c1', quote: 'q', text: 't' }]);
    await user.click(screen.getByRole('button', { name: /Remove comment/ }));
    expect(onRemoveComment).toHaveBeenCalledWith('c1');
  });

  test('key 1 chooses auto', async () => {
    const { onDecision, user } = setup();
    await user.keyboard('1');
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }),
    );
  });

  test('key 2 chooses manual', async () => {
    const { onDecision, user } = setup();
    await user.keyboard('2');
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ updatedPermissions: [{ type: 'setMode', mode: 'default', destination: 'session' }] }),
    );
  });

  test('key 3 keeps planning', async () => {
    const { onDecision, user } = setup();
    await user.keyboard('3');
    expect(onDecision).toHaveBeenCalledWith({ behavior: 'deny', message: KEEP_PLANNING_MESSAGE });
  });

  test('modifier keys do not trigger shortcuts', async () => {
    const { onDecision, user } = setup();
    await user.keyboard('{Control>}1{/Control}');
    expect(onDecision).not.toHaveBeenCalled();
  });

  test('digits typed in the feedback input do not trigger shortcuts', async () => {
    const { onDecision, user } = setup();
    await user.type(screen.getByRole('textbox'), '123');
    expect(onDecision).not.toHaveBeenCalled();
  });

  test('first button reads auto mode when priorMode is auto', () => {
    setup([], 'auto');
    expect(screen.getByRole('button', { name: /Yes, and use auto mode/ })).toBeInTheDocument();
  });

  test('typed feedback relabels the third button and is sent', async () => {
    const { onDecision, user } = setup();
    await user.type(screen.getByRole('textbox'), 'more tests');
    await user.click(screen.getByRole('button', { name: /Send feedback and keep planning/ }));
    expect(onDecision).toHaveBeenCalledWith({ behavior: 'deny', message: `${KEEP_PLANNING_MESSAGE}\n\nmore tests` });
  });

  test('comments are formatted into keep-planning feedback', async () => {
    const { onDecision, user } = setup([{ id: 'c1', quote: 'q', text: 't' }]);
    await user.click(screen.getByRole('button', { name: /Send feedback and keep planning/ }));
    expect(onDecision).toHaveBeenCalledWith({
      behavior: 'deny',
      message: `${KEEP_PLANNING_MESSAGE}\n\nComments on the plan:\n- "q": t`,
    });
  });
});
