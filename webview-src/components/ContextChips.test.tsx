import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ContextChips } from './ContextChips';

describe('ContextChips', () => {
  test('a file context renders the basename with the full path as the tooltip', () => {
    render(<ContextChips context={{ filePath: '/repo/src/app.ts' }} onDismiss={() => {}} />);

    const chip = screen.getByTestId('context-chip-file');
    expect(chip).toHaveTextContent('app.ts');
    expect(chip).toHaveAttribute('title', '/repo/src/app.ts');
    expect(screen.queryByTestId('context-chip-selection')).not.toBeInTheDocument();
  });

  test('a selection context renders basename:start-end and no separate file chip', () => {
    render(
      <ContextChips
        context={{ filePath: '/repo/src/app.ts', selection: { startLine: 3, endLine: 9, text: 'x' } }}
       
        onDismiss={() => {}}
      />,
    );

    const chip = screen.getByTestId('context-chip-selection');
    expect(chip).toHaveTextContent('app.ts:3-9');
    expect(chip).toHaveAttribute('title', '/repo/src/app.ts');
    expect(screen.queryByTestId('context-chip-file')).not.toBeInTheDocument();
  });

  test('a Windows path shows its basename', () => {
    render(<ContextChips context={{ filePath: 'C:\\repo\\src\\app.ts' }} onDismiss={() => {}} />);
    expect(screen.getByTestId('context-chip-file')).toHaveTextContent('app.ts');
  });

  test('a null context renders nothing', () => {
    const { container } = render(<ContextChips context={null} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('the remove button calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <ContextChips
        context={{ filePath: '/repo/a.ts', selection: { startLine: 1, endLine: 2 } }}
       
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove a.ts:1-2 from context' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
