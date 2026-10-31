import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ToolUseBlock } from '../lib/conversationModel';
import fixtures from '../lib/__fixtures__/permission-protocol.json';
import { SessionContext } from '../store/sessionStore';
import type { Action, SessionStoreState } from '../store/sessionStore';
import { ExitPlanModeBlock } from './ExitPlanModeBlock';

const postMessage = vi.fn();
vi.mock('../lib/ipc', () => ({ postMessage: (m: unknown) => postMessage(m) }));

const planInput = fixtures.exitPlanControlRequest.request.input as Record<string, unknown>;
const approved = { text: fixtures.exitPlanToolResult.content, isError: false };
const stayed = { text: fixtures.exitPlanDeniedToolResult.content, isError: true };

function makeTool(input: Record<string, unknown>, result?: { text: string; isError: boolean }): ToolUseBlock {
  return { type: 'tool_use', id: 'tu1', name: 'ExitPlanMode', input, ...(result && { result }) };
}

function renderBlock(tool: ToolUseBlock, dispatch: (a: Action) => void = () => undefined, isPending = true) {
  const pending = isPending
    ? [{ channelId: 'ch', requestId: 'r1', toolName: 'ExitPlanMode', toolUseId: tool.id, input: {} }]
    : [];
  const state: SessionStoreState = {
    channels: {},
    permissions: { ch: { pending, answers: {}, decisions: {}, planComments: {} } },
  };
  return render(
    <SessionContext.Provider value={{ state, dispatch, handleMessage: () => undefined }}>
      <ExitPlanModeBlock tool={tool} channelId="ch" running={false} />
    </SessionContext.Provider>,
  );
}

beforeEach(() => postMessage.mockClear());
afterEach(() => vi.restoreAllMocks());

function selectPlanText(container: HTMLElement) {
  const body = container.querySelector('.cc-plan-block-body') as HTMLElement;
  const range = document.createRange();
  range.selectNodeContents(body.querySelector('li')!.firstChild!);
  vi.spyOn(window, 'getSelection').mockReturnValue({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => 'Create hello.txt',
    getRangeAt: () => range,
  } as unknown as Selection);
  fireEvent.mouseUp(body);
  return body;
}

describe('ExitPlanModeBlock', () => {
  test('Escape in the popover clears it without bubbling to the dock', async () => {
    const onKeyDown = vi.fn();
    const { container } = renderBlock(makeTool(planInput));
    document.body.addEventListener('keydown', onKeyDown);
    selectPlanText(container);
    await userEvent.type(screen.getByRole('textbox'), 'x{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onKeyDown.mock.calls.some(([e]) => (e as KeyboardEvent).key === 'Escape')).toBe(false);
    document.body.removeEventListener('keydown', onKeyDown);
  });

  test('Cancel clears the popover', async () => {
    const { container } = renderBlock(makeTool(planInput));
    selectPlanText(container);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('a mouseup with an empty selection clears the popover', () => {
    const { container } = renderBlock(makeTool(planInput));
    const body = selectPlanText(container);
    vi.spyOn(window, 'getSelection').mockReturnValue({ rangeCount: 0, toString: () => '' } as unknown as Selection);
    fireEvent.mouseUp(body);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('with no pending request a selection opens no popover', () => {
    const { container } = renderBlock(makeTool(planInput, approved), undefined, false);
    selectPlanText(container);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('file name is taken from a Windows path too', () => {
    renderBlock(makeTool({ ...planInput, planFilePath: 'C:\\plans\\p.md' }));
    expect(screen.getByRole('link', { name: 'p.md' })).toBeInTheDocument();
  });

  test("header reads Claude's Plan with a file link that opens the file", async () => {
    renderBlock(makeTool(planInput, approved));
    expect(screen.getByText("Claude's Plan")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'plan-creating-a-file-vast-quail.md' }));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'open_file',
      filePath: '/Users/joe/.claude/plans/plan-creating-a-file-vast-quail.md',
    });
  });

  test('empty input reads Plan Mode and renders no body', () => {
    const { container } = renderBlock(makeTool({}));
    expect(screen.getByText('Plan Mode')).toBeInTheDocument();
    expect(container.querySelector('.cc-plan-block-body')).toBeNull();
  });

  test('result line for approved and stayed', () => {
    const { unmount } = renderBlock(makeTool(planInput, approved));
    expect(screen.getByText('User approved the plan')).toBeInTheDocument();
    unmount();
    renderBlock(makeTool(planInput, stayed));
    expect(screen.getByText('Stayed in plan mode')).toBeInTheDocument();
  });

  test('selecting text and submitting the popover dispatches COMMENT_ADDED', async () => {
    const dispatch = vi.fn();
    const { container } = renderBlock(makeTool(planInput), dispatch);
    const body = container.querySelector('.cc-plan-block-body') as HTMLElement;
    const textNode = body.querySelector('li')!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      toString: () => 'Create hello.txt',
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(body);
    await userEvent.type(screen.getByRole('textbox'), 'use bye.txt');
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'COMMENT_ADDED',
      channelId: 'ch',
      toolUseId: 'tu1',
      comment: { id: expect.any(String), quote: 'Create hello.txt', text: 'use bye.txt' },
    });
  });
});
