import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { TerminalLauncher, shellQuote } from '../../../src/terminal/TerminalLauncher';

// Mirror the real macOS global-storage path: it contains a space, which is why
// the launcher must shell-quote before sendText.
const BINARY =
  '/Users/me/Library/Application Support/Code/User/globalStorage/claw-code/claude-cli/2.1.168/claude-darwin-arm64';

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

    it('sends the resolved binary path, shell-quoted, as the first command', async () => {
      await launcher.openClaudeTerminal();
      expect(mockTerminal.sendText).toHaveBeenCalledWith(shellQuote(BINARY));
      // The raw (space-containing) path must never be sent unquoted.
      expect(mockTerminal.sendText).not.toHaveBeenCalledWith(BINARY);
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

  describe('shellQuote()', () => {
    it('quotes a path with spaces so the shell runs it as one command', () => {
      const quoted = shellQuote('/a b/claude');
      if (process.platform === 'win32') {
        expect(quoted).toBe('& "/a b/claude"');
      } else {
        expect(quoted).toBe(`'/a b/claude'`);
      }
    });

    it('escapes embedded quote characters (POSIX)', () => {
      if (process.platform === 'win32') return;
      expect(shellQuote(`/a'b/claude`)).toBe(`'/a'\\''b/claude'`);
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
