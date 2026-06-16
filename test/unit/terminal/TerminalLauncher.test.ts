import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { TerminalLauncher } from '../../../src/terminal/TerminalLauncher';

const BINARY = '/global-storage/claude-cli/2.1.168/claude-darwin-arm64';

describe('TerminalLauncher', () => {
  let launcher: TerminalLauncher;
  let mockTerminal: { show: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    launcher = new TerminalLauncher(() => Promise.resolve(BINARY));
    mockTerminal = { show: vi.fn(), sendText: vi.fn() };
    mockVscode.window.createTerminal.mockReturnValue(mockTerminal);
    mockVscode.workspace.workspaceFolders = undefined;
  });

  describe('openClaudeTerminal()', () => {
    it('creates a named terminal', async () => {
      await launcher.openClaudeTerminal();
      expect(mockVscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Claw Code' }),
      );
    });

    it('sends the resolved binary path as the first command', async () => {
      await launcher.openClaudeTerminal();
      expect(mockTerminal.sendText).toHaveBeenCalledWith(BINARY);
    });

    it('calls show() on the created terminal', async () => {
      await launcher.openClaudeTerminal();
      expect(mockTerminal.show).toHaveBeenCalled();
    });

    it('uses the provided cwd', async () => {
      await launcher.openClaudeTerminal('/my/project');
      expect(mockVscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: '/my/project' }),
      );
    });
  });

  describe('openTerminal()', () => {
    it('creates a named terminal without sending any command', () => {
      launcher.openTerminal();
      expect(mockVscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Claw Code Terminal' }),
      );
      expect(mockTerminal.sendText).not.toHaveBeenCalled();
    });

    it('calls show() on the created terminal', () => {
      launcher.openTerminal();
      expect(mockTerminal.show).toHaveBeenCalled();
    });
  });
});
