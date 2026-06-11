import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);
vi.mock('../../../src/utils/platform', () => ({
  resolveBinaryPath: vi.fn(() => '/ext/resources/native-binary/claude'),
}));

import { TerminalLauncher } from '../../../src/terminal/TerminalLauncher';

describe('TerminalLauncher', () => {
  let launcher: TerminalLauncher;
  let mockTerminal: { show: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    launcher = new TerminalLauncher('/ext');
    mockTerminal = { show: vi.fn(), sendText: vi.fn() };
    mockVscode.window.createTerminal.mockReturnValue(mockTerminal);
    mockVscode.workspace.workspaceFolders = undefined;
  });

  describe('openClaudeTerminal()', () => {
    it('creates a named terminal', () => {
      launcher.openClaudeTerminal();
      expect(mockVscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Claw Code' }),
      );
    });

    it('sends the binary path as the first command', () => {
      launcher.openClaudeTerminal();
      expect(mockTerminal.sendText).toHaveBeenCalledWith(
        '/ext/resources/native-binary/claude',
      );
    });

    it('calls show() on the created terminal', () => {
      launcher.openClaudeTerminal();
      expect(mockTerminal.show).toHaveBeenCalled();
    });

    it('uses the provided cwd', () => {
      launcher.openClaudeTerminal('/my/project');
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
