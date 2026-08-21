import type { ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { AssistantTurn } from './AssistantTurn';
import { RunOutputProvider } from './RunOutputContext';
import type { AssistantBlock } from '../lib/conversationModel';

const foldableBlocks: AssistantBlock[] = [
  { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.py' }, result: { text: 'ok', isError: false } },
  { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' }, result: { text: 'ok', isError: false } },
];

/** AssistantTurn's MarkdownText reads RunOutputContext (normally supplied by MessageList). */
function renderTurn(ui: ReactElement) {
  return render(<RunOutputProvider>{ui}</RunOutputProvider>);
}

describe('AssistantTurn: focusView=false (default)', () => {
  test('renders text and tool_use blocks exactly as before', () => {
    renderTurn(
      <AssistantTurn
        channelId="ch-1"
        blocks={[{ type: 'text', text: 'hello' }, ...foldableBlocks]}
      />,
    );
    expect(screen.getAllByTestId('tool-call')).toHaveLength(2);
    expect(screen.queryByTestId('focus-summary-row')).not.toBeInTheDocument();
  });

  test('renders a thinking block via ThinkingSummary (new, unconditional)', () => {
    renderTurn(
      <AssistantTurn
        channelId="ch-1"
        blocks={[{ type: 'thinking', text: 'pondering' }]}
      />,
    );
    expect(screen.getByTestId('thinking-summary')).toHaveTextContent('Thought');
  });
});

describe('AssistantTurn: focusView=true', () => {
  test('collapses a run of routine tool calls behind FocusSummaryRow by default', () => {
    renderTurn(<AssistantTurn channelId="ch-1" blocks={foldableBlocks} focusView />);
    expect(screen.queryByTestId('tool-call')).not.toBeInTheDocument();
    const row = screen.getByTestId('focus-summary-row');
    expect(row).toHaveTextContent('Used 2 tool(s) (Read, Bash)');
  });

  test('the always-visible tool renders unfolded', () => {
    const blocks: AssistantBlock[] = [
      { type: 'tool_use', id: 't1', name: 'TodoWrite', input: {}, result: { text: 'ok', isError: false } },
    ];
    renderTurn(<AssistantTurn channelId="ch-1" blocks={blocks} focusView />);
    expect(screen.getByTestId('tool-call')).toHaveTextContent('TodoWrite');
    expect(screen.queryByTestId('focus-summary-row')).not.toBeInTheDocument();
  });

  test('clicking the toggle expands and re-collapses the folded group', () => {
    renderTurn(<AssistantTurn channelId="ch-1" blocks={foldableBlocks} focusView />);
    expect(screen.queryByTestId('tool-call')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('focus-summary-toggle'));
    expect(screen.getAllByTestId('tool-call')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('focus-summary-toggle'));
    expect(screen.queryByTestId('tool-call')).not.toBeInTheDocument();
  });

  test('a running group whose last tool has no result shows the live indicator', () => {
    const blocks: AssistantBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.py' } },
    ];
    renderTurn(<AssistantTurn channelId="ch-1" blocks={blocks} focusView running />);
    expect(screen.getByTestId('focus-summary-row')).toHaveTextContent('Running Read…');
  });

  test('a non-running group with no result shows the plain count summary', () => {
    const blocks: AssistantBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.py' } },
    ];
    renderTurn(<AssistantTurn channelId="ch-1" blocks={blocks} focusView />);
    expect(screen.getByTestId('focus-summary-row')).toHaveTextContent('Used 1 tool(s) (Read)');
  });
});
