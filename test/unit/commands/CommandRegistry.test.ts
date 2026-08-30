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
  const viewManager = {
    toggleFocusView: vi.fn(() => true),
    broadcastSessionStates: vi.fn(),
  };

  function makeRegistry() {
    return new CommandRegistry(
      { extensionPath: '/ext' },
      panelOpener as never,
      diffManager as never,
      diffTracker as never,
      sessionHistory as never,
      terminalLauncher as never,
      logger,
      viewManager,
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
    expect(registeredIds).toContain('clawd-vscode.editor.open');
    expect(registeredIds).toContain('clawd-vscode.acceptProposedDiff');
    expect(registeredIds).toContain('clawd-vscode.rejectProposedDiff');
    expect(registeredIds).toContain('clawd-vscode.terminal.open');
    expect(registeredIds).toContain('clawd-vscode.showLogs');
    expect(registeredIds).toContain('clawd-vscode.reopenClosedSession');
  });

  const registeredIds = () =>
    mockVscode.commands.registerCommand.mock.calls.map((c: [string, ...unknown[]]) => c[0]);

  const isOriginalId = (id: string) =>
    id.startsWith('claude-code.') || id.startsWith('claude-vscode.');

  it('does NOT register any original command ID when Anthropic.claude-code is installed', () => {
    // The real extension owns claude-vscode.* / claude-code.* — re-registering
    // threw `command '...' already exists` and crash-looped the host.
    mockVscode.extensions.getExtension.mockReturnValue({ id: 'anthropic.claude-code' });
    makeRegistry().register();
    expect(registeredIds().filter(isOriginalId)).toEqual([]);
  });

  it('registers the full compatibility alias set when the real extension is absent', () => {
    mockVscode.extensions.getExtension.mockReturnValue(undefined);
    makeRegistry().register();
    const ids = registeredIds();
    // Primary namespace (1:1 mirror) …
    expect(ids).toContain('claude-vscode.editor.open');
    expect(ids).toContain('claude-vscode.acceptProposedDiff');
    expect(ids).toContain('claude-vscode.insertAtMention');
    expect(ids).toContain('claude-vscode.terminal.open.keyboard');
    // … plus the older claude-code.* IDs the real extension still carries.
    expect(ids).toContain('claude-code.acceptProposedDiff');
    expect(ids).toContain('claude-code.rejectProposedDiff');
    expect(ids).toContain('claude-code.insertAtMentioned');
  });

  it('a compat alias delegates to the canonical clawd-vscode.* command', () => {
    mockVscode.extensions.getExtension.mockReturnValue(undefined);
    makeRegistry().register();
    for (const [legacyId, ourId] of [
      ['claude-vscode.editor.open', 'clawd-vscode.editor.open'],
      ['claude-code.acceptProposedDiff', 'clawd-vscode.acceptProposedDiff'],
    ]) {
      const call = mockVscode.commands.registerCommand.mock.calls.find(
        (c: [string, ...unknown[]]) => c[0] === legacyId,
      );
      (call[1] as () => void)();
      expect(mockVscode.commands.executeCommand).toHaveBeenCalledWith(ourId);
    }
  });

  it('editor.open calls panelOpener.openNewPanel', async () => {
    const registry = makeRegistry();
    registry.register();

    const call = mockVscode.commands.registerCommand.mock.calls.find(
      (c: [string, ...unknown[]]) => c[0] === 'clawd-vscode.editor.open',
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
      (c: [string, ...unknown[]]) => c[0] === 'clawd-vscode.acceptProposedDiff',
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
      (c: [string, ...unknown[]]) => c[0] === 'clawd-vscode.acceptProposedDiff',
    );
    const handler = call?.[1] as () => void;
    handler();
    expect(diffManager.acceptDiff).not.toHaveBeenCalled();
  });

  it('terminal.open calls terminalLauncher.openClaudeTerminal', () => {
    const registry = makeRegistry();
    registry.register();

    const call = mockVscode.commands.registerCommand.mock.calls.find(
      (c: [string, ...unknown[]]) => c[0] === 'clawd-vscode.terminal.open',
    );
    const handler = call?.[1] as () => void;
    handler();
    expect(terminalLauncher.openClaudeTerminal).toHaveBeenCalled();
  });

  it('showLogs calls logger.info', () => {
    const registry = makeRegistry();
    registry.register();

    const call = mockVscode.commands.registerCommand.mock.calls.find(
      (c: [string, ...unknown[]]) => c[0] === 'clawd-vscode.showLogs',
    );
    const handler = call?.[1] as () => void;
    handler();
    expect(logger.info).toHaveBeenCalled();
  });

  it('registers clawd-vscode.toggleFocusView', () => {
    const registry = makeRegistry();
    registry.register();
    expect(registeredIds()).toContain('clawd-vscode.toggleFocusView');
  });

  it('toggleFocusView calls viewManager.toggleFocusView() then broadcastSessionStates()', () => {
    const registry = makeRegistry();
    registry.register();

    const call = mockVscode.commands.registerCommand.mock.calls.find(
      (c: [string, ...unknown[]]) => c[0] === 'clawd-vscode.toggleFocusView',
    );
    const handler = call?.[1] as () => void;
    handler();
    expect(viewManager.toggleFocusView).toHaveBeenCalledOnce();
    expect(viewManager.broadcastSessionStates).toHaveBeenCalledOnce();
  });
});
