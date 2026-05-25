/** Lifecycle state of a conversation session. */
export type ConversationState = 'idle' | 'running' | 'error';

/** Persistent metadata for a single conversation session. */
export interface SessionState {
  id: string;
  title: string | undefined;
  state: ConversationState;
  /** ISO timestamp of the last update. */
  updatedAt: string;
}

/** Extended session info returned in list_sessions_response. */
export interface SessionInfo extends SessionState {
  /** True if the session has been soft-deleted (hidden from the list). */
  hidden: boolean;
}
