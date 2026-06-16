import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ContextUsageRing } from './ContextUsageRing';
import type { ContextUsage } from '../lib/ipc';

const usage: ContextUsage = {
  categories: [
    { name: 'Messages', tokens: 15360, color: 'purple_FOR_SUBAGENTS_ONLY' },
    { name: 'MCP tools (deferred)', tokens: 54688, color: 'inactive', isDeferred: true },
    { name: 'Free space', tokens: 948702, color: 'promptBorder' },
  ],
  totalTokens: 44771,
  maxTokens: 1_000_000,
  percentage: 4,
};

describe('ContextUsageRing', () => {
  test('click opens the breakdown popover and refreshes usage', () => {
    const onRefresh = vi.fn();
    render(<ContextUsageRing usage={usage} onCompact={() => {}} onRefresh={onRefresh} />);

    expect(screen.queryByTestId('context-breakdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('usage-ring').querySelector('.cc-ring')!);

    const popover = screen.getByTestId('context-breakdown');
    expect(popover).toHaveTextContent('Messages');
    expect(popover).toHaveTextContent('44.8k / 1.0M (4%)');
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  test('PreCompact button fires onCompact and closes the popover', () => {
    const onCompact = vi.fn();
    render(<ContextUsageRing usage={usage} onCompact={onCompact} />);

    fireEvent.click(screen.getByTestId('usage-ring').querySelector('.cc-ring')!);
    fireEvent.click(screen.getByTestId('precompact-button'));

    expect(onCompact).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('context-breakdown')).not.toBeInTheDocument();
  });
});
