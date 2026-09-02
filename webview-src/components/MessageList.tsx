import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildConversation, type ResultMeta } from '../lib/conversationModel';
import { AssistantTurn } from './AssistantTurn';
import { UserTurn } from './UserTurn';
import { RunOutputProvider } from './RunOutputContext';
import { ExtensionContext } from '../store/extensionStore';
import type { ClaudeStreamEvent } from '../lib/ipc';

/** Renders the derived conversation and keeps the view pinned to the bottom. */
export function MessageList({
  events,
  channelId,
  running = false,
}: {
  events: ClaudeStreamEvent[];
  channelId: string;
  /** True while the channel's process is actively streaming a turn. */
  running?: boolean;
}) {
  const turns = useMemo(() => buildConversation(events), [events]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const ext = useContext(ExtensionContext);
  const focusViewEnabled = ext?.state.focusViewEnabled ?? false;

  const lastAssistantIndex = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]?.kind === 'assistant') return i;
    }
    return -1;
  }, [turns]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <RunOutputProvider>
      <div data-testid="messages-list" className="cc-messages">
        {turns.map((turn, i) => {
        switch (turn.kind) {
          case 'user':
            return <UserTurn key={turn.key} text={turn.text} />;
          case 'assistant':
            return (
              <AssistantTurn
                key={turn.key}
                blocks={turn.blocks}
                channelId={channelId}
                focusView={focusViewEnabled}
                running={running && i === lastAssistantIndex}
              />
            );
          case 'result':
            return <ResultLine key={turn.key} isError={turn.isError} meta={turn.meta} />;
          case 'error':
            return <ErrorLine key={turn.key} message={turn.message} />;
          case 'handoff_prompt':
            return <HandoffPromptBlock key={turn.key} content={turn.content} />;
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

function HandoffPromptBlock({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="cc-handoff-prompt">
      <div className="cc-handoff-prompt__header">
        <span>Compaction blocked — paste this into a new session</span>
        <button className="cc-handoff-prompt__copy" onClick={copy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="cc-handoff-prompt__body">{content}</pre>
    </div>
  );
}
