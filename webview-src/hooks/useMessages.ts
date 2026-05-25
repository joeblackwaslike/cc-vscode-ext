import { useEffect } from 'react';
import type { ToWebviewMessage } from '../lib/ipc';

/**
 * Subscribes to messages posted from the extension host via `postMessage`.
 * The handler is called for every `MessageEvent` received on the window.
 */
export function useMessages(handler: (msg: ToWebviewMessage) => void): void {
  useEffect(() => {
    const listener = (event: MessageEvent<ToWebviewMessage>) => {
      if (event.data && typeof event.data === 'object' && 'type' in event.data) {
        handler(event.data);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handler]);
}
