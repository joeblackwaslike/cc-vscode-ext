/** Ambient types for the VS Code webview API injected at runtime. */
declare function acquireVsCodeApi<TState = unknown>(): {
  postMessage(message: unknown): void;
  getState(): TState | undefined;
  setState(state: TState): void;
};

declare interface Window {
  IS_SIDEBAR?: boolean;
  IS_FULL_EDITOR?: boolean;
  IS_SESSION_LIST_ONLY?: boolean;
}
