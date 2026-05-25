import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { CommandRegistry } from '../../../src/commands/CommandRegistry';

describe('CommandRegistry', () => {
  const panelOpener = {
    openNewPanel: vi.fn(() => Promise.resolve()),
    reopenLastSession: vi.fn(() => Promise.resolve()),
  };
  const diffManager = {
    hasDiff: vi.fn(() => false),
    acceptDiff: vi.fn(() => Promise.resolve()),
    rejectDiff: vi.fn(),
  };
  const diffTracker = { trackDiff: vi.fn(), untrackDiff: vi.fn() };
  const sessionHistory = {
    getLastClosed: vi.fn(() => undefined as string | undefined),
    clearLastClosed: vi.fn(),
  };
  const terminalLauncher = {
    openClaudeTerminal: vi.fn(),
    openTerminal: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  function makeRegistry() {
    return new CommandRegistry(
      { extensionPath: '/ext' },
      panelOpener as never,
      diffManager as never,
      diffTracker as never,
      sessionHistory as never,
      terminalLauncher as never,
      logger,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockVscode.window.activeTextEditor = undefined;
    // registerCommand returns a disposable and captures the handler
    mockVscode.commands.registerCommand.mockImplementation(
      (_id: string, handler: () => void) => ({ dispose: vi.fn(), _handler: handler }),
    );
  });

  it('register() returns a non-empty array of disposables', () => {
    const registry = makeRegistry();
    const disposables = registry.register();
    expect(disposables.length).toBeGreaterThan(0);
  });

  it('registers all expected command IDs', () => {
    const registry = makeRegistry();
    registry.register();

    const registeredIds = mockVscode.commands.registerCommand.mock.calls.map(
      (c: [string, ...unknown[]]) => c[0],
    );
    expect(registeredIds).toContain('claude-vscode.editor.open');
    expect(registeredIds).toContain('claude-vscode.acceptProposedDiff');
    expect(registeredIds).toContain('claude-vscode.rejectProposedDiff');
    expect(registeredIds).toContain('claude-code.acceptProposedDiff');
    expect(registeredIds).toContain('claude-code.rejectProposedDiff');
    expect(registeredIds).toContain('claude-vscode.terminal.open');
    expect(registeredIds).toContain('claude-vscode.showLogs');
    expect(registeredIds).toContain('claude-vscode.reopenClosedSession');
  });

  it('editor.open calls panelOpener.openNewPanel', async () => {
    const registry = makeRegistry();
    registry.register();

    const call = mockVscode.commands.registerCommand.mock.calls.find(
      (c: [string, ...unknown[]]) => c[0] === 'claude-vscode.editor.open',
    );
    const handler = call?.[1] as () => Promise<void>;
    await handler();
    expect(panelOpener.openNewPanel).toHaveBeenCalled();
  });

  it('acceptProposedDiff calls diffManager.acceptDiff when active editor has a diff', async () => {
    diffManager.hasDiff.mockReturnValue(true);
    const fakeUri = { toString: () => 'right:///test.ts' };
    mockVscode.window.activeTextEditor = {
      document: { uri: fakeUri },
    } as never;

    const registry = makeRegistry();
    registry.register();

    const call = mockVscode.commands.registerCommand.mock.calls.find(
      (c: [string, ...unknown[]]) => c[0] === 'claude-vscode.acceptProposedDiff',
    );
    const handler = call?.[1] as () => Promise<void>;
    await handler();
    expect(diffManager.acceptDiff).toHaveBeenCalledWith(fakeUri);
  });

  it('acceptProposedDiff is a no-op when active editor has no diff', async () => {
    diffManager.hasDiff.mockReturnValue(false);
    mockVscode.window.activeTextEditor = {
      document: { uri: { toString: () => 'file:///test.ts' } },
    } as never;

    const registry = makeRegistry();
    registry.register();

    const call = mockVscode.commands.registerCommand.mock.calls.find(
      (c: [string, ...unknown[]]) => c[0] === 'claude-vscode.acceptProposedDiff',
    );
    const handler = call?.[1] as () => void;
    handler();
    expect(diffManager.acceptDiff).not.toHaveBeenCalled();
  });

  it('terminal.open calls terminalLauncher.openClaudeTerminal', () => {
    const registry = makeRegistry();
    registry.register();

    const call = mockVscode.commands.registerCommand.mock.calls.find(
      (c: [string, ...unknown[]]) => c[0] === 'claude-vscode.terminal.open',
    );
    const handler = call?.[1] as () => void;
    handler();
    expect(terminalLauncher.openClaudeTerminal).toHaveBeenCalled();
  });

  it('showLogs calls logger.info', () => {
    const registry = makeRegistry();
    registry.register();

    const call = mockVscode.commands.registerCommand.mock.calls.find(
      (c: [string, ...unknown[]]) => c[0] === 'claude-vscode.showLogs',
    );
    const handler = call?.[1] as () => void;
    handler();
    expect(logger.info).toHaveBeenCalled();
  });
});
