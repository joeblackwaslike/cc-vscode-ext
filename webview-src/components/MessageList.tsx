import { useEffect, useMemo, useRef } from 'react';
import { buildConversation, type ResultMeta } from '../lib/conversationModel';
import { AssistantTurn } from './AssistantTurn';
import { UserTurn } from './UserTurn';
import { RunOutputProvider } from './RunOutputContext';
import type { ClaudeStreamEvent } from '../lib/ipc';

/** Renders the derived conversation and keeps the view pinned to the bottom. */
export function MessageList({ events }: { events: ClaudeStreamEvent[] }) {
  const turns = useMemo(() => buildConversation(events), [events]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <RunOutputProvider>
      <div data-testid="messages-list" className="cc-messages">
        {turns.map((turn) => {
        switch (turn.kind) {
          case 'user':
            return <UserTurn key={turn.key} text={turn.text} />;
          case 'assistant':
            return <AssistantTurn key={turn.key} blocks={turn.blocks} />;
          case 'result':
            return <ResultLine key={turn.key} isError={turn.isError} meta={turn.meta} />;
          case 'error':
            return <ErrorLine key={turn.key} message={turn.message} />;
        }
      })}
        <div ref={bottomRef} />
      </div>
    </RunOutputProvider>
  );
}

function ResultLine({ isError, meta }: { isError: boolean; meta: ResultMeta }) {
  if (isError) return <div className="cc-result__err">✗ Error</div>;
  return (
    <div className="cc-result">
      <span className="cc-result__ok">✓ Done</span>
      {formatMeta(meta) && <span>· {formatMeta(meta)}</span>}
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div data-testid="chat-message-error" className="cc-error">
      ✗ {message}
    </div>
  );
}

function formatMeta(meta: ResultMeta): string {
  const parts: string[] = [];
  if (meta.usedTokens) parts.push(`${formatTokens(meta.usedTokens)} tokens`);
  if (meta.durationMs) parts.push(`${(meta.durationMs / 1000).toFixed(1)}s`);
  if (meta.costUsd) parts.push(`$${meta.costUsd.toFixed(2)}`);
  return parts.join(' · ');
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
