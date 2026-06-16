import type { ThinkingLevel } from '../types/ipc';

/** Permission modes that map to the `--permission-mode` CLI flag. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

/**
 * Live effort changes go through the `set_max_thinking_tokens` control request
 * (the CLI has no live `--effort` equivalent), so each effort level maps to a
 * thinking-token budget. Approximate but monotonic; tune freely.
 */
export const EFFORT_THINKING_TOKENS: Record<ThinkingLevel, number> = {
  low: 4_000,
  medium: 10_000,
  high: 20_000,
  xhigh: 32_000,
  max: 64_000,
};

/** Options that control how the claude CLI is launched for a given channel. */
export interface LaunchOptions {
  /** Resume an existing session by ID. */
  resume?: string;
  /** Override the default permission mode. */
  permissionMode?: PermissionMode;
  /** Reasoning effort → `--effort <level>`. */
  effort?: ThinkingLevel;
  /** Model alias or id → `--model`. */
  model?: string;
  /** Pass `--allow-dangerously-skip-permissions` (sandbox use only). */
  allowDangerouslySkipPermissions?: boolean;
}

/**
 * Builds the argument array for spawning the claude CLI.
 *
 * The CLI is always started in stream-json mode (bidirectional NDJSON over stdin/stdout).
 * The `--permission-prompt-tool stdio` flag delegates permission prompts back through
 * the IPC channel so the webview can present them to the user.
 */
export function buildArgs(options: LaunchOptions): string[] {
  const args: string[] = [
    '--output-format', 'stream-json',
    '--verbose',
    '--input-format', 'stream-json',
  ];

  if (options.resume) {
    args.push('--resume', options.resume);
  }

  if (options.permissionMode && options.permissionMode !== 'default') {
    args.push('--permission-mode', options.permissionMode);
  } else {
    // Default mode: route permission prompts through IPC so the webview handles them
    args.push('--permission-prompt-tool', 'stdio');
  }

  if (options.effort) {
    args.push('--effort', options.effort);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.allowDangerouslySkipPermissions) {
    args.push('--allow-dangerously-skip-permissions');
  }

  return args;
}
