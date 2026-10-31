import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import type { ToolUseBlock } from '../lib/conversationModel';
import fixtures from '../lib/__fixtures__/permission-protocol.json';
import { SessionContext } from '../store/sessionStore';
import type { SessionStoreState } from '../store/sessionStore';
import { AskUserQuestionBlock, splitAnswer } from './AskUserQuestionBlock';

const base = fixtures.askToolUse as unknown as { id: string; name: string; input: Record<string, unknown> };

function makeTool(result?: { text: string; isError: boolean }): ToolUseBlock {
  return { type: 'tool_use', id: base.id, name: base.name, input: base.input, ...(result && { result }) };
}

const answered = { text: fixtures.askToolResult.content, isError: false };
const declined = { text: fixtures.askDeniedToolResult.content, isError: true };

function renderBlock(
  tool: ToolUseBlock,
  running = false,
  answers: Record<string, string> | undefined = undefined,
  decision?: 'cancelled',
) {
  const state: SessionStoreState = {
    channels: {},
    permissions: {
      ch: { pending: [], answers: answers ? { [tool.id]: answers } : {}, decisions: decision ? { [tool.id]: decision } : {}, planComments: {} },
    },
  };
  return render(
    <SessionContext.Provider value={{ state, dispatch: () => undefined, handleMessage: () => undefined }}>
      <AskUserQuestionBlock tool={tool} channelId="ch" running={running} />
    </SessionContext.Provider>,
  );
}

describe('AskUserQuestionBlock', () => {
  test('running with nothing pending yet reads Waiting for answer and stays expanded', () => {
    renderBlock(makeTool(), true);
    expect(screen.getByText(/Waiting for answer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
  });

  test('a cancelled prompt while running reads No answer', () => {
    renderBlock(makeTool(), true, undefined, 'cancelled');
    expect(screen.getByText(/No answer/)).toBeInTheDocument();
  });

  test('header shows Questions and the count', () => {
    renderBlock(makeTool(answered));
    expect(screen.getByText('Questions')).toBeInTheDocument();
    expect(screen.getByText(/Answered · 2 questions/)).toBeInTheDocument();
  });

  test('declined result shows Declined', () => {
    renderBlock(makeTool(declined));
    expect(screen.getByText(/Declined/)).toBeInTheDocument();
  });

  test('no result, not pending, not running shows Session ended', () => {
    renderBlock(makeTool());
    expect(screen.getByText(/Session ended/)).toBeInTheDocument();
  });

  test('expanded, selected options are checked and unselected are dim; Other holds typed text', async () => {
    renderBlock(makeTool(answered));
    await userEvent.click(screen.getByRole('button', { name: /Questions/ }));
    expect(screen.getByRole('checkbox', { name: /Cat/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /Dog/ })).toHaveAttribute('aria-checked', 'true');
    const fish = screen.getByRole('checkbox', { name: /Fish/ });
    expect(fish).toHaveAttribute('aria-checked', 'false');
    expect(fish.className).toContain('cc-ask-block-option--dim');
    expect(screen.getByRole('radio', { name: /Other/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('My custom other answer')).toHaveClass('cc-ask-typed-answer');
  });

  test('store answers win over parsed answers', async () => {
    renderBlock(makeTool(answered), false, {
      'What is your favorite color?': 'Blue',
      'Which pets do you have?': 'Fish',
    });
    await userEvent.click(screen.getByRole('button', { name: /Questions/ }));
    expect(screen.getByRole('radio', { name: /Blue/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Red/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: /Fish/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('My custom other answer')).not.toBeInTheDocument();
  });
});

describe('splitAnswer', () => {
  const question = (multiSelect: boolean, labels: string[]) =>
    ({
      question: 'Q',
      header: 'H',
      multiSelect,
      options: labels.map((label) => ({ label, description: '' })),
    }) as never;

  test('a single-select label containing a comma is one selected option', () => {
    expect(splitAnswer('Yes, always', question(false, ['Yes, always', 'No']))).toEqual({
      selected: ['Yes, always'],
      typed: '',
    });
  });

  test('single-select typed text that starts with an option label stays typed', () => {
    expect(splitAnswer('Red, white', question(false, ['Red', 'Blue']))).toEqual({
      selected: [],
      typed: 'Red, white',
    });
  });

  test('multi-select consumes comma-containing labels longest first', () => {
    expect(splitAnswer('Yes, always, No', question(true, ['Yes', 'Yes, always', 'No']))).toEqual({
      selected: ['Yes, always', 'No'],
      typed: '',
    });
  });

  test('multi-select keeps typed text that sits between labels', () => {
    expect(splitAnswer('Cat, Llama, Dog', question(true, ['Cat', 'Dog']))).toEqual({
      selected: ['Cat', 'Dog'],
      typed: 'Llama',
    });
  });
});
