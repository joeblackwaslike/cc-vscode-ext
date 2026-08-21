/** Lifecycle state of a conversation session. */
export type ConversationState = 'idle' | 'running' | 'error';

/** Persistent metadata for a single conversation session. */
export interface SessionState {
  id: string;
  title: string | undefined;
  state: ConversationState;
  /** ISO timestamp of the last update. */
  updatedAt: string;
  /** Sidebar group this session belongs to. Undefined = ungrouped. */
  groupId?: string;
}

/** Extended session info returned in list_sessions_response. */
export interface SessionInfo extends SessionState {
  /** True if the session has been soft-deleted (hidden from the list). */
  hidden: boolean;
}

/** A user-defined group used to bucket sessions in the sidebar. */
export interface SessionGroup {
  id: string;
  name: string;
}
