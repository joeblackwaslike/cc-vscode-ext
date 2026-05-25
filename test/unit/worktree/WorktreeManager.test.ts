import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeManager } from '../../../src/worktree/WorktreeManager';

describe('WorktreeManager', () => {
  let execFn: ReturnType<typeof vi.fn>;
  let manager: WorktreeManager;

  beforeEach(() => {
    execFn = vi.fn();
    manager = new WorktreeManager(execFn);
  });

  describe('createWorktree()', () => {
    it('returns success with worktree path on success', async () => {
      execFn.mockResolvedValue({ stdout: '', stderr: '' });
      const result = await manager.createWorktree('feature/x', '/project');
      expect(result.type).toBe('create_worktree_response');
      expect(result.success).toBe(true);
      expect(result.worktreePath).toContain('feature/x');
    });

    it('calls exec with git worktree add command', async () => {
      execFn.mockResolvedValue({ stdout: '', stderr: '' });
      await manager.createWorktree('my-branch', '/project');
      expect(execFn).toHaveBeenCalledWith(
        expect.stringContaining('git worktree add'),
        expect.objectContaining({ cwd: '/project' }),
      );
    });

    it('includes the branch name in the exec command', async () => {
      execFn.mockResolvedValue({ stdout: '', stderr: '' });
      await manager.createWorktree('my-branch', '/project');
      expect(execFn).toHaveBeenCalledWith(
        expect.stringContaining('my-branch'),
        expect.anything(),
      );
    });

    it('returns failure with error message on exec error', async () => {
      execFn.mockRejectedValue(new Error('branch already exists'));
      const result = await manager.createWorktree('my-branch', '/project');
      expect(result.success).toBe(false);
      expect(result.error).toContain('branch already exists');
    });
  });

  describe('checkGitStatus()', () => {
    it('returns clean=true and branch name when working tree is clean', async () => {
      execFn
        .mockResolvedValueOnce({ stdout: '', stderr: '' })           // git status --porcelain
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });    // git branch --show-current

      const result = await manager.checkGitStatus('/project');
      expect(result.type).toBe('check_git_status_response');
      expect(result.clean).toBe(true);
      expect(result.branch).toBe('main');
    });

    it('returns clean=false when there are uncommitted changes', async () => {
      execFn
        .mockResolvedValueOnce({ stdout: 'M src/index.ts\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'feature/x\n', stderr: '' });

      const result = await manager.checkGitStatus('/project');
      expect(result.clean).toBe(false);
      expect(result.branch).toBe('feature/x');
    });

    it('returns branch=undefined when branch output is empty', async () => {
      execFn
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await manager.checkGitStatus('/project');
      expect(result.branch).toBeUndefined();
    });

    it('returns clean=false and undefined branch on exec error', async () => {
      execFn.mockRejectedValue(new Error('not a git repo'));
      const result = await manager.checkGitStatus('/not-a-repo');
      expect(result.clean).toBe(false);
      expect(result.branch).toBeUndefined();
    });
  });

  describe('checkoutBranch()', () => {
    it('returns success=true on successful checkout', async () => {
      execFn.mockResolvedValue({ stdout: '', stderr: '' });
      const result = await manager.checkoutBranch('main', '/project');
      expect(result.type).toBe('checkout_branch_response');
      expect(result.success).toBe(true);
    });

    it('calls exec with git checkout command', async () => {
      execFn.mockResolvedValue({ stdout: '', stderr: '' });
      await manager.checkoutBranch('main', '/project');
      expect(execFn).toHaveBeenCalledWith(
        expect.stringContaining('git checkout'),
        expect.objectContaining({ cwd: '/project' }),
      );
    });

    it('returns failure with error on exec error', async () => {
      execFn.mockRejectedValue(new Error('pathspec not found'));
      const result = await manager.checkoutBranch('nonexistent', '/project');
      expect(result.success).toBe(false);
      expect(result.error).toContain('pathspec not found');
    });
  });
});
