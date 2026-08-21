import type { PermissionMode } from '../process/ProcessArgs';
import type { ClaudeStreamEvent } from './process';
import type { DiffFile } from './diff';
import type { ConversationState, SessionInfo, SessionGroup } from './session';

export type { SessionGroup };

// ─── Effort levels ───────────────────────────────────────────────────────────
// Mirrors the claude CLI `--effort <level>` choices (verified via `claude --help`).
// Named ThinkingLevel for backwards-compat with the existing IPC field.

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const DEFAULT_EFFORT: ThinkingLevel = 'medium';

// ═════════════════════════════════════════════════════════════════════════════
// Webview → Extension Host (FromWebviewMessage)
// ═════════════════════════════════════════════════════════════════════════════

// ─── Process lifecycle ───────────────────────────────────────────────────────

export interface LaunchClaudeMessage {
  type: 'launch_claude';
  channelId: string;
  resume?: string;
  cwd?: string;
  permissionMode?: PermissionMode;
  thinkingLevel?: ThinkingLevel;
  model?: string;
}

export interface CloseChannelMessage {
  type: 'close_channel';
  channelId: string;
}

export interface InterruptClaudeMessage {
  type: 'interrupt_claude';
  channelId: string;
}

export interface CancelRequestMessage {
  type: 'cancel_request';
  channelId: string;
  requestId: string;
}

/** Forward a user message/input to the claude subprocess on the given channel. */
export interface ControlRequestMessage {
  type: 'control_request';
  channelId: string;
  requestId: string;
  /** Raw user text. The host wraps it in the CLI's stream-json user envelope. */
  text: string;
}

// ─── State queries ───────────────────────────────────────────────────────────

export interface GetClaudeStateMessage { type: 'get_claude_state' }
export interface GetAuthStatusMessage { type: 'get_auth_status' }
export interface AssetUrisMessage { type: 'asset_uris' }
export interface GetContextUsageMessage { type: 'get_context_usage'; channelId: string }
export interface GetRelayThresholdMessage { type: 'get_relay_threshold'; channelId?: string }
export interface SetRelayThresholdMessage { type: 'set_relay_threshold'; threshold: number; channelId?: string }
export interface GetMcpServersMessage { type: 'get_mcp_servers' }
export interface GetTerminalContentsMessage { type: 'get_terminal_contents' }

// ─── Session management ───────────────────────────────────────────────────────

export interface ListSessionsRequestMessage {
  type: 'list_sessions_request';
  includeHidden?: boolean;
}

export interface GetSessionRequestMessage {
  type: 'get_session_request';
  sessionId: string;
}

export interface DeleteSessionMessage {
  type: 'delete_session';
  sessionId: string;
}

export interface RenameSessionMessage {
  type: 'rename_session';
  sessionId: string;
  title: string;
}

export interface UpdateSessionStateMessage {
  type: 'update_session_state';
  sessionId: string;
  state: ConversationState;
  title?: string;
}

export interface GenerateSessionTitleMessage {
  type: 'generate_session_title';
  channelId: string;
}

export interface RenameTabMessage {
  type: 'rename_tab';
  title: string;
}

export interface TeleportSessionMessage {
  type: 'teleport_session';
  sessionId: string;
}

export interface ListRemoteSessionsMessage { type: 'list_remote_sessions' }

export interface CreateSessionGroupMessage {
  type: 'create_session_group';
  name: string;
}

export interface RenameSessionGroupMessage {
  type: 'rename_session_group';
  groupId: string;
  name: string;
}

export interface DeleteSessionGroupMessage {
  type: 'delete_session_group';
  groupId: string;
}

export interface MoveSessionsToGroupMessage {
  type: 'move_sessions_to_group';
  sessionIds: string[];
  groupId: string | null;
}

// ─── File & editor operations ────────────────────────────────────────────────

export interface ListFilesRequestMessage {
  type: 'list_files_request';
  query: string;
  cwd?: string;
}

export interface GetCurrentSelectionMessage { type: 'get_current_selection' }

export interface OpenDiffMessage {
  type: 'open_diff';
  oldContent: string;
  newContent: string;
  filePath: string;
  channelId: string;
}

export interface OpenFileDiffsMessage {
  type: 'open_file_diffs';
  files: DiffFile[];
  channelId: string;
}

export interface OpenFileMessage {
  type: 'open_file';
  filePath: string;
  line?: number;
}

export interface OpenUrlMessage {
  type: 'open_url';
  url: string;
}

export interface OpenFolderMessage {
  type: 'open_folder';
  folderPath: string;
}

export interface OpenFolderInNewWindowMessage {
  type: 'open_folder_in_new_window';
  folderPath: string;
}

export interface OpenConfigMessage { type: 'open_config' }
export interface OpenConfigFileMessage { type: 'open_config_file'; filePath: string }
export interface OpenContentMessage { type: 'open_content'; content: string; language?: string }
export interface OpenInEditorMessage { type: 'open_in_editor'; content: string; filePath: string }
export interface OpenOutputPanelMessage { type: 'open_output_panel' }
export interface OpenMarkdownPreviewMessage { type: 'open_markdown_preview'; content: string; channelId: string }
export interface OpenTerminalMessage { type: 'open_terminal' }
export interface OpenHelpMessage { type: 'open_help' }
export interface OpenClaudeInTerminalMessage { type: 'open_claude_in_terminal' }

// ─── Conversation actions ────────────────────────────────────────────────────

export interface LoginMessage { type: 'login'; provider?: string }
export interface LogoutMessage { type: 'logout' }

export interface NewConversationTabMessage { type: 'new_conversation_tab' }

export interface ForkConversationMessage {
  type: 'fork_conversation';
  channelId: string;
  messageIndex: number;
}

export interface RewindCodeMessage {
  type: 'rewind_code';
  channelId: string;
  messageIndex: number;
}

export interface ClosePlanPreviewMessage { type: 'close_plan_preview'; channelId: string }
export interface GetPlanCommentsMessage { type: 'get_plan_comments'; channelId: string }
export interface RemovePlanCommentMessage { type: 'remove_plan_comment'; channelId: string; commentId: string }

// ─── Settings & configuration ────────────────────────────────────────────────

export interface SetPermissionModeMessage {
  type: 'set_permission_mode';
  channelId: string;
  mode: PermissionMode;
  persist?: boolean;
}

export interface SetModelMessage { type: 'set_model'; model: string; channelId?: string }
export interface SetThinkingLevelMessage { type: 'set_thinking_level'; level: ThinkingLevel; channelId?: string }
export interface ApplySettingsMessage { type: 'apply_settings'; settings: Record<string, unknown> }

// ─── Git / worktree ───────────────────────────────────────────────────────────

export interface CreateWorktreeMessage { type: 'create_worktree'; branchName: string; cwd: string }
export interface CheckGitStatusMessage { type: 'check_git_status'; cwd: string }
export interface CheckoutBranchMessage { type: 'checkout_branch'; branchName: string; cwd: string }
export interface UpdateSkippedBranchMessage { type: 'update_skipped_branch'; branchName: string }

// ─── Inline command execution ──────────────────────────────────────────────────

/**
 * Run a shell command from a code block's play button. The webview mints
 * `execId` to correlate the streamed `run_command_output` / `run_command_done`
 * events back to the originating output panel.
 */
export interface RunCommandMessage {
  type: 'run_command';
  execId: string;
  command: string;
  cwd?: string;
}

// ─── Plugin management ───────────────────────────────────────────────────────

export interface InstallPluginMessage { type: 'install_plugin'; pluginId: string }
export interface ListPluginsMessage { type: 'list_plugins' }
export interface SetPluginEnabledMessage { type: 'set_plugin_enabled'; pluginId: string; enabled: boolean }
export interface UninstallPluginMessage { type: 'uninstall_plugin'; pluginId: string }
export interface AddMarketplaceMessage { type: 'add_marketplace'; url: string }
export interface ListMarketplacesMessage { type: 'list_marketplaces' }
export interface RemoveMarketplaceMessage { type: 'remove_marketplace'; url: string }
export interface RefreshMarketplaceMessage { type: 'refresh_marketplace'; url: string }

// ─── MCP ─────────────────────────────────────────────────────────────────────

export interface ReconnectMcpServerMessage { type: 'reconnect_mcp_server'; serverName: string }
export interface SetMcpServerEnabledMessage { type: 'set_mcp_server_enabled'; serverName: string; enabled: boolean }
export interface EnsureChromeMcpEnabledMessage { type: 'ensure_chrome_mcp_enabled' }
export interface DisableChromeMcpMessage { type: 'disable_chrome_mcp' }
export interface EnableJupyterMcpMessage { type: 'enable_jupyter_mcp' }
export interface DisableJupyterMcpMessage { type: 'disable_jupyter_mcp' }
export interface CreateNewBrowserTabMessage { type: 'create_new_browser_tab'; url: string }
export interface AuthenticateMcpServerMessage { type: 'authenticate_mcp_server'; serverName: string }
export interface ClearMcpServerAuthMessage { type: 'clear_mcp_server_auth'; serverName: string }
export interface SubmitOAuthCodeMessage { type: 'submit_oauth_code'; code: string }
export interface ToggleRemoteControlMessage { type: 'toggle_remote_control' }

// ─── Speech ──────────────────────────────────────────────────────────────────

export interface StartSpeechToTextMessage { type: 'start_speech_to_text'; channelId: string }
export interface StopSpeechToTextMessage { type: 'stop_speech_to_text'; channelId: string }
export interface ToggleDictationMessage { type: 'toggle_dictation' }

// ─── Telemetry / feedback ────────────────────────────────────────────────────

export interface LogEventMessage { type: 'log_event'; event: string; properties?: Record<string, unknown> }
export interface MessageRatedMessage { type: 'message_rated'; messageId: string; rating: 'up' | 'down' }
export interface SubmitFeedbackMessage { type: 'submit_feedback'; text: string }
export interface RequestUsageUpdateMessage { type: 'request_usage_update'; channelId: string }

// ─── UI state ────────────────────────────────────────────────────────────────

export interface DismissOnboardingMessage { type: 'dismiss_onboarding' }
export interface DismissReviewUpsellBannerMessage { type: 'dismiss_review_upsell_banner' }
export interface DismissTerminalBannerMessage { type: 'dismiss_terminal_banner' }
export interface ShowClaudeTerminalSettingMessage { type: 'show_claude_terminal_setting' }
export interface AskDebuggerHelpMessage { type: 'ask_debugger_help'; content: string }

// ─── Tool permissions ────────────────────────────────────────────────────────

export interface ToolPermissionRequestMessage {
  type: 'tool_permission_request';
  channelId: string;
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/** Union of all messages sent from the webview to the extension host. */
export type FromWebviewMessage =
  | LaunchClaudeMessage
  | CloseChannelMessage
  | InterruptClaudeMessage
  | CancelRequestMessage
  | ControlRequestMessage
  | GetClaudeStateMessage
  | GetAuthStatusMessage
  | AssetUrisMessage
  | GetContextUsageMessage
  | GetRelayThresholdMessage
  | SetRelayThresholdMessage
  | GetMcpServersMessage
  | GetTerminalContentsMessage
  | ListSessionsRequestMessage
  | GetSessionRequestMessage
  | DeleteSessionMessage
  | RenameSessionMessage
  | UpdateSessionStateMessage
  | GenerateSessionTitleMessage
  | RenameTabMessage
  | TeleportSessionMessage
  | ListRemoteSessionsMessage
  | CreateSessionGroupMessage
  | RenameSessionGroupMessage
  | DeleteSessionGroupMessage
  | MoveSessionsToGroupMessage
  | ListFilesRequestMessage
  | GetCurrentSelectionMessage
  | OpenDiffMessage
  | OpenFileDiffsMessage
  | OpenFileMessage
  | OpenUrlMessage
  | OpenFolderMessage
  | OpenFolderInNewWindowMessage
  | OpenConfigMessage
  | OpenConfigFileMessage
  | OpenContentMessage
  | OpenInEditorMessage
  | OpenOutputPanelMessage
  | OpenMarkdownPreviewMessage
  | OpenTerminalMessage
  | OpenHelpMessage
  | OpenClaudeInTerminalMessage
  | LoginMessage
  | LogoutMessage
  | NewConversationTabMessage
  | ForkConversationMessage
  | RewindCodeMessage
  | ClosePlanPreviewMessage
  | GetPlanCommentsMessage
  | RemovePlanCommentMessage
  | SetPermissionModeMessage
  | SetModelMessage
  | SetThinkingLevelMessage
  | ApplySettingsMessage
  | CreateWorktreeMessage
  | CheckGitStatusMessage
  | CheckoutBranchMessage
  | UpdateSkippedBranchMessage
  | RunCommandMessage
  | InstallPluginMessage
  | ListPluginsMessage
  | SetPluginEnabledMessage
  | UninstallPluginMessage
  | AddMarketplaceMessage
  | ListMarketplacesMessage
  | RemoveMarketplaceMessage
  | RefreshMarketplaceMessage
  | ReconnectMcpServerMessage
  | SetMcpServerEnabledMessage
  | EnsureChromeMcpEnabledMessage
  | DisableChromeMcpMessage
  | EnableJupyterMcpMessage
  | DisableJupyterMcpMessage
  | CreateNewBrowserTabMessage
  | AuthenticateMcpServerMessage
  | ClearMcpServerAuthMessage
  | SubmitOAuthCodeMessage
  | ToggleRemoteControlMessage
  | StartSpeechToTextMessage
  | StopSpeechToTextMessage
  | ToggleDictationMessage
  | LogEventMessage
  | MessageRatedMessage
  | SubmitFeedbackMessage
  | RequestUsageUpdateMessage
  | DismissOnboardingMessage
  | DismissReviewUpsellBannerMessage
  | DismissTerminalBannerMessage
  | ShowClaudeTerminalSettingMessage
  | AskDebuggerHelpMessage
  | ToolPermissionRequestMessage;

// ═════════════════════════════════════════════════════════════════════════════
// Extension Host → Webview (ToWebviewMessage)
// ═════════════════════════════════════════════════════════════════════════════

/** Relays a raw stream-json event from the claude subprocess to the webview. */
export interface StreamRequestMessage {
  type: 'request';
  channelId: string;
  requestId: string;
  request: ClaudeStreamEvent;
}

export interface UpdateStateMessage {
  type: 'update_state';
  sessions: SessionInfo[];
  groups: SessionGroup[];
  activeSessionId: string | undefined;
  defaultPermissionMode: PermissionMode;
  thinkingLevel: ThinkingLevel;
  model?: string;
}

/** One row of the context-window breakdown (from the CLI's get_context_usage). */
export interface ContextCategory {
  name: string;
  tokens: number;
  /** Semantic color key from the CLI (e.g. 'warning', 'claude', 'inactive'). */
  color: string;
  isDeferred?: boolean;
}

/** Full context-window occupancy — drives the ring + breakdown popover. */
export interface ContextUsage {
  categories: ContextCategory[];
  totalTokens: number;
  maxTokens: number;
  percentage: number;
}

export interface ContextUsageMessage {
  type: 'context_usage';
  channelId: string;
  usage: ContextUsage;
}

/** Sent once a SessionRelayManager swap completes, so the webview can mark the transcript. */
export interface RelayStartedMessage {
  type: 'relay_started';
  channelId: string;
  fromSessionId?: string | undefined;
  toSessionId?: string | undefined;
}

/** Current relay threshold (percentage, 0-100) for a channel, or the global default when channelId is omitted. */
export interface RelayThresholdMessage {
  type: 'relay_threshold';
  channelId?: string | undefined;
  threshold: number;
}

export interface AssetUrisResponseMessage {
  type: 'asset_uris_response';
  assetUris: Record<string, { light: string; dark: string }>;
}

export interface GetClaudeStateResponseMessage {
  type: 'get_claude_state_response';
  state: Record<string, unknown>;
}

export interface GetAuthStatusResponseMessage {
  type: 'get_auth_status_response';
  authenticated: boolean;
  loginUrl?: string;
}

export interface OpenDiffResponseMessage { type: 'open_diff_response' }
export interface OpenFileResponseMessage { type: 'open_file_response' }

export interface ListFilesResponseMessage {
  type: 'list_files_response';
  files: string[];
}

export interface GetCurrentSelectionResponseMessage {
  type: 'get_current_selection_response';
  text: string;
  filePath: string | undefined;
  startLine: number | undefined;
  endLine: number | undefined;
}

export interface ListSessionsResponseMessage {
  type: 'list_sessions_response';
  sessions: SessionInfo[];
  groups: SessionGroup[];
}

export interface GetSessionResponseMessage {
  type: 'get_session_response';
  session: SessionInfo | null;
}

export interface DeleteSessionResponseMessage {
  type: 'delete_session_response';
  success: boolean;
}

export interface RenameSessionResponseMessage { type: 'rename_session_response' }
export interface UpdateSessionStateResponseMessage { type: 'update_session_state_response' }

export interface GenerateSessionTitleResponseMessage {
  type: 'generate_session_title_response';
  title: string;
}

export interface ShowNotificationMessage {
  type: 'show_notification';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface InsertAtMentionMessage {
  type: 'insert_at_mention';
  text: string;
}

export interface AtMentionedMessage {
  type: 'at_mentioned';
  filePath: string;
}

export interface KeepAliveMessage { type: 'keep_alive' }

export interface CreateWorktreeResponseMessage {
  type: 'create_worktree_response';
  success: boolean;
  worktreePath?: string;
  error?: string;
}

export interface CheckGitStatusResponseMessage {
  type: 'check_git_status_response';
  clean: boolean;
  branch: string | undefined;
}

export interface CheckoutBranchResponseMessage {
  type: 'checkout_branch_response';
  success: boolean;
  error?: string;
}

/** One streamed chunk of output from an inline `run_command`. */
export interface RunCommandOutputMessage {
  type: 'run_command_output';
  execId: string;
  chunk: string;
  stream: 'stdout' | 'stderr';
}

/** Terminal event for an inline `run_command` — carries the final exit code. */
export interface RunCommandDoneMessage {
  type: 'run_command_done';
  execId: string;
  /** Undefined when shell integration ran the command but couldn't report a code. */
  exitCode: number | undefined;
}

/** Union of all messages sent from the extension host to the webview. */
export type ToWebviewMessage =
  | StreamRequestMessage
  | UpdateStateMessage
  | ContextUsageMessage
  | RelayStartedMessage
  | RelayThresholdMessage
  | AssetUrisResponseMessage
  | GetClaudeStateResponseMessage
  | GetAuthStatusResponseMessage
  | OpenDiffResponseMessage
  | OpenFileResponseMessage
  | ListFilesResponseMessage
  | GetCurrentSelectionResponseMessage
  | ListSessionsResponseMessage
  | GetSessionResponseMessage
  | DeleteSessionResponseMessage
  | RenameSessionResponseMessage
  | UpdateSessionStateResponseMessage
  | GenerateSessionTitleResponseMessage
  | ShowNotificationMessage
  | InsertAtMentionMessage
  | AtMentionedMessage
  | KeepAliveMessage
  | CreateWorktreeResponseMessage
  | CheckGitStatusResponseMessage
  | CheckoutBranchResponseMessage
  | RunCommandOutputMessage
  | RunCommandDoneMessage;
