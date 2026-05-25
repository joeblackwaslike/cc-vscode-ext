import type { FromWebviewMessage, ToWebviewMessage } from '../../src/types/ipc';
import type { ClaudeStreamEvent } from '../../src/types/process';
import type { SessionInfo, ConversationState } from '../../src/types/session';
import type { PermissionMode } from '../../src/process/ProcessArgs';
import type { ThinkingLevel } from '../../src/types/ipc';

export type {
  FromWebviewMessage,
  ToWebviewMessage,
  ClaudeStreamEvent,
  SessionInfo,
  ConversationState,
  PermissionMode,
  ThinkingLevel,
};

let _api: ReturnType<typeof acquireVsCodeApi> | null = null;

function getApi(): ReturnType<typeof acquireVsCodeApi> {
  if (!_api) _api = acquireVsCodeApi();
  return _api;
}

export function postMessage(msg: FromWebviewMessage): void {
  getApi().postMessage(msg);
}

export function getPersistedState<T>(): T | undefined {
  return getApi().getState() as T | undefined;
}

export function persistState<T>(state: T): void {
  getApi().setState(state);
}
