import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import fixture from '../../lib/__fixtures__/permission-protocol.json';
import type { PermissionRequest } from '../../lib/ipc';
import { ASK_DECLINE_MESSAGE } from '../../lib/permissions';
import { AskUserQuestionForm } from './AskUserQuestionForm';

function makeRequest(input?: Record<string, unknown>): PermissionRequest {
  const req = fixture.askControlRequest.request;
  return {
    channelId: 'ch',
    requestId: 'req',
    toolName: 'AskUserQuestion',
    input: input ?? (req.input as Record<string, unknown>),
    toolUseId: req.tool_use_id,
    suggestions: undefined,
    description: undefined,
    priorMode: undefined,
  };
}

function setup(input?: Record<string, unknown>) {
  const onDecision = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(<AskUserQuestionForm request={makeRequest(input)} onDecision={onDecision} />);
  return { onDecision, user };
}

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

afterEach(() => { vi.useRealTimers(); });

describe('AskUserQuestionForm', () => {
  test('renders one tab per header', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Color', 'Pets']);
    expect(screen.getByRole('tab', { name: 'Color' })).toHaveAttribute('aria-selected', 'true');
  });

  test('single-select auto-advances to the next tab after 300 ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: /Red/ }));
    expect(screen.getByRole('radio', { name: /Red/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('tab', { name: 'Color' })).toHaveAttribute('aria-selected', 'true');
    advance(300);
    expect(screen.getByRole('tab', { name: 'Pets' })).toHaveAttribute('aria-selected', 'true');
  });

  test('multi-select toggles checkboxes and does not auto-advance', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Pets' }));
    await user.click(screen.getByRole('checkbox', { name: /Cat/ }));
    await user.click(screen.getByRole('checkbox', { name: /Dog/ }));
    await user.click(screen.getByRole('checkbox', { name: /Cat/ }));
    advance(1000);
    expect(screen.getByRole('checkbox', { name: /Cat/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: /Dog/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('tab', { name: 'Pets' })).toHaveAttribute('aria-selected', 'true');
  });

  test('arrow keys move focus and switch tabs; number keys pick options', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: /Red/ }));
    advance(300);
    await user.click(screen.getByRole('tab', { name: 'Color' }));
    screen.getByRole('radio', { name: /Red/ }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /Blue/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Pets' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Color' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('2');
    expect(screen.getByRole('radio', { name: /Blue/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('number shortcuts are ignored while Cmd, Ctrl or Alt is held', async () => {
    const { user } = setup();
    screen.getByRole('radio', { name: /Red/ }).focus();
    await user.keyboard('{Meta>}2{/Meta}{Control>}2{/Control}{Alt>}2{/Alt}');
    expect(screen.getByRole('radio', { name: /Blue/ })).toHaveAttribute('aria-checked', 'false');
  });

  test('Other with empty text disables Submit, typing there ignores shortcuts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: /Other/ }));
    const input = screen.getByPlaceholderText('Type your answer…');
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled();
    await user.keyboard('2{ArrowRight}');
    expect(input).toHaveValue('2');
    expect(screen.getByRole('tab', { name: 'Color' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Submit sends the built answers once every question is answered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, onDecision } = setup();
    await user.click(screen.getByRole('radio', { name: /Red/ }));
    advance(300);
    await user.click(screen.getByRole('checkbox', { name: /Cat/ }));
    await user.click(screen.getByRole('checkbox', { name: /Fish/ }));
    await user.click(screen.getByRole('button', { name: 'Submit answers' }));
    expect(onDecision).toHaveBeenCalledWith({
      behavior: 'allow',
      updatedInput: {
        ...(fixture.askControlRequest.request.input),
        answers: { 'What is your favorite color?': 'Red', 'Which pets do you have?': 'Cat, Fish' },
      },
    });
  });

  test('Submit stays disabled until every question is answered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, onDecision } = setup();
    await user.click(screen.getByRole('radio', { name: /Red/ }));
    advance(300);
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(onDecision).not.toHaveBeenCalled();
  });

  test('Decline denies with the decline message', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, onDecision } = setup();
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onDecision).toHaveBeenCalledWith({ behavior: 'deny', message: ASK_DECLINE_MESSAGE });
  });

  test('Fold hides the body but keeps the tab bar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Fold' }));
    expect(screen.queryByRole('radio', { name: /Red/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  test('options with previews show a preview pane and do not auto-advance', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup({
      questions: [
        {
          question: 'Layout?',
          header: 'Layout',
          multiSelect: false,
          options: [
            { label: 'A', preview: 'preview **alpha**' },
            { label: 'B', preview: 'preview beta' },
          ],
        },
        { question: 'Next?', header: 'Next', multiSelect: false, options: [{ label: 'X' }] },
      ],
    });
    expect(screen.getByText('alpha')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /B/ }));
    expect(screen.getByText('preview beta')).toBeInTheDocument();
    advance(1000);
    expect(screen.getByRole('tab', { name: 'Layout' })).toHaveAttribute('aria-selected', 'true');
  });
});
