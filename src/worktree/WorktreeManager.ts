import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import type {
  CreateWorktreeResponseMessage,
  CheckGitStatusResponseMessage,
  CheckoutBranchResponseMessage,
} from '../types/ipc';

const execAsync = promisify(exec);

type ExecFn = (cmd: string, opts?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>;

/**
 * Runs git operations for worktree management on behalf of the webview.
 *
 * All methods return typed IPC response messages so callers can forward them
 * directly to the webview via `webview.postMessage`.
 */
export class WorktreeManager {
  constructor(private readonly execFn: ExecFn = execAsync) {}

  async createWorktree(branchName: string, cwd: string): Promise<CreateWorktreeResponseMessage> {
    const worktreePath = join(cwd, '..', branchName);
    try {
      await this.execFn(`git worktree add -b "${branchName}" "${worktreePath}"`, { cwd });
      return { type: 'create_worktree_response', success: true, worktreePath };
    } catch (err) {
      return {
        type: 'create_worktree_response',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async checkGitStatus(cwd: string): Promise<CheckGitStatusResponseMessage> {
    try {
      const [statusResult, branchResult] = await Promise.all([
        this.execFn('git status --porcelain', { cwd }),
        this.execFn('git branch --show-current', { cwd }),
      ]);
      return {
        type: 'check_git_status_response',
        clean: statusResult.stdout.trim() === '',
        branch: branchResult.stdout.trim() || undefined,
      };
    } catch {
      return { type: 'check_git_status_response', clean: false, branch: undefined };
    }
  }

  async checkoutBranch(branchName: string, cwd: string): Promise<CheckoutBranchResponseMessage> {
    try {
      await this.execFn(`git checkout "${branchName}"`, { cwd });
      return { type: 'checkout_branch_response', success: true };
    } catch (err) {
      return {
        type: 'checkout_branch_response',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
