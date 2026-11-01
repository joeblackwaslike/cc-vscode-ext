import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { DefaultModeOffer } from './DefaultModeOffer';

function setup() {
  const onAnswer = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(<DefaultModeOffer mode="bypassPermissions" currentDefault="plan" onAnswer={onAnswer} />);
  return { onAnswer, user };
}

describe('DefaultModeOffer', () => {
  test('renders the spec text', () => {
    setup();
    expect(screen.getByText('Set bypassPermissions as your default mode?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yes, set bypassPermissions as my default/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No, keep plan/ })).toBeInTheDocument();
  });

  test('Yes and No call onAnswer', async () => {
    const { onAnswer, user } = setup();
    await user.click(screen.getByRole('button', { name: /Yes/ }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: /No/ }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  test('keys 1 and 2 select, Escape counts as No', async () => {
    const { onAnswer, user } = setup();
    await user.keyboard('1');
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    await user.keyboard('2');
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    onAnswer.mockClear();
    await user.keyboard('{Escape}');
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  test('an auto-repeated 1 held over from the plan card does not accept', () => {
    const { onAnswer } = setup();
    fireEvent.keyDown(screen.getByText('Set bypassPermissions as your default mode?'), { key: '1', repeat: true });
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
