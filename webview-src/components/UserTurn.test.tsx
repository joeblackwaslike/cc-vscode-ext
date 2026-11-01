import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { UserTurn } from './UserTurn';

describe('UserTurn', () => {
  test('renders just the bubble without ide chips', () => {
    render(<UserTurn text="hello" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.queryByTestId('history-chip-file')).not.toBeInTheDocument();
  });

  test('renders file and selection chips with basename labels and full-path titles', () => {
    render(
      <UserTurn
        text="hello"
        ide={[
          { kind: 'file', path: '/r/src/a.ts' },
          { kind: 'selection', path: '/r/src/b.ts', startLine: 3, endLine: 5 },
        ]}
      />,
    );
    const file = screen.getByTestId('history-chip-file');
    expect(file).toHaveTextContent('a.ts');
    expect(file).toHaveAttribute('title', '/r/src/a.ts');
    const sel = screen.getByTestId('history-chip-selection');
    expect(sel).toHaveTextContent('b.ts:3-5');
    expect(sel).toHaveAttribute('title', '/r/src/b.ts');
  });

  test('renders no bubble when text is empty', () => {
    render(<UserTurn text="" ide={[{ kind: 'file', path: '/r/a.ts' }]} />);
    expect(screen.getByTestId('history-chip-file')).toBeInTheDocument();
    expect(document.querySelector('.cc-user__bubble')).toBeNull();
  });
});
