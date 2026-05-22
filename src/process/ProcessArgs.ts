/** Permission modes that map to the `--permission-mode` CLI flag. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

/** Options that control how the claude CLI is launched for a given channel. */
export interface LaunchOptions {
  /** Resume an existing session by ID. */
  resume?: string;
  /** Override the default permission mode. */
  permissionMode?: PermissionMode;
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

  if (options.allowDangerouslySkipPermissions) {
    args.push('--allow-dangerously-skip-permissions');
  }

  return args;
}
