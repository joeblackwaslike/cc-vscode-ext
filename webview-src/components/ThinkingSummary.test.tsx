import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ThinkingSummary } from './ThinkingSummary';

describe('ThinkingSummary', () => {
  test('clicking the toggle on an already-finished turn (running=false) expands and stays expanded', () => {
    // Regression: the auto-recollapse effect used to key off the steady
    // `!running` state instead of the running->false transition, so on any
    // already-finished turn (running === false on every render, including
    // scrollback) a click set manuallyExpanded=true, the effect re-ran
    // because manuallyExpanded changed, `!running && manuallyExpanded` was
    // true, and it immediately collapsed again in the same commit — making
    // the raw thinking text permanently unreachable on every historical turn.
    render(<ThinkingSummary text="the raw reasoning" running={false} />);

    expect(screen.queryByText('the raw reasoning')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('thinking-summary-toggle'));
    expect(screen.getByText('the raw reasoning')).toBeInTheDocument();
  });

  test('clicking again collapses it back', () => {
    render(<ThinkingSummary text="the raw reasoning" running={false} />);
    fireEvent.click(screen.getByTestId('thinking-summary-toggle'));
    expect(screen.getByText('the raw reasoning')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('thinking-summary-toggle'));
    expect(screen.queryByText('the raw reasoning')).not.toBeInTheDocument();
  });

  test('shows "Thinking…" while running', () => {
    render(<ThinkingSummary text="still going" running />);
    expect(screen.getByTestId('thinking-summary')).toHaveTextContent('Thinking…');
  });

  test('manually expanding while running auto-recollapses once the turn completes', () => {
    const { rerender } = render(<ThinkingSummary text="the raw reasoning" running />);
    fireEvent.click(screen.getByTestId('thinking-summary-toggle'));
    expect(screen.getByText('the raw reasoning')).toBeInTheDocument();

    rerender(<ThinkingSummary text="the raw reasoning" running={false} />);
    expect(screen.queryByText('the raw reasoning')).not.toBeInTheDocument();
  });

  test('shows a duration once the turn completes without ever being expanded', () => {
    const { rerender } = render(<ThinkingSummary text="the raw reasoning" running />);
    rerender(<ThinkingSummary text="the raw reasoning" running={false} />);
    expect(screen.getByTestId('thinking-summary')).toHaveTextContent(/Thought for \d+s/);
  });
});
