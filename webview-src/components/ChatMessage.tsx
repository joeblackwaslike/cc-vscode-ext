import React from 'react';
import { renderMarkdown } from '../lib/markdown';
import type { ClaudeStreamEvent } from '../lib/ipc';

interface Props {
  event: ClaudeStreamEvent;
}

export function ChatMessage({ event }: Props) {
  switch (event.type) {
    case 'user':
      return <UserMessage event={event} />;
    case 'assistant':
      return <AssistantMessage event={event} />;
    case 'result':
      return <ResultMessage event={event} />;
    case 'error':
      return <ErrorMessage event={event} />;
    case 'system':
      return null; // don't render system init events
    default:
      return null;
  }
}

function UserMessage({ event }: { event: ClaudeStreamEvent }) {
  const message = event.message as string | { content?: unknown } | undefined;
  const text =
    typeof message === 'string'
      ? message
      : typeof message === 'object' && message !== null
        ? extractText(message.content)
        : '';

  if (!text) return null;

  return (
    <div data-testid="chat-message-user" style={styles.userBubble}>
      <span style={styles.roleLabel}>You</span>
      <div style={styles.userText}>{text}</div>
    </div>
  );
}

function AssistantMessage({ event }: { event: ClaudeStreamEvent }) {
  const message = event.message as { content?: unknown[] } | undefined;
  const content = Array.isArray(message?.content) ? message.content : [];

  return (
    <div style={styles.assistantBubble}>
      <span style={styles.roleLabel}>Claude</span>
      {content.map((block, i) => (
        <ContentBlock key={i} block={block as Record<string, unknown>} />
      ))}
    </div>
  );
}

function ContentBlock({ block }: { block: Record<string, unknown> }) {
  if (block.type === 'text') {
    const html = renderMarkdown(String(block.text ?? ''));
    return (
      <div
        style={styles.markdown}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  if (block.type === 'tool_use') {
    return (
      <div style={styles.toolBlock}>
        <span style={styles.toolName}>⚙ {String(block.name ?? 'tool')}</span>
        <pre style={styles.toolInput}>
          {JSON.stringify(block.input, null, 2)}
        </pre>
      </div>
    );
  }

  return null;
}

function ResultMessage({ event }: { event: ClaudeStreamEvent }) {
  const subtype = event.subtype as string | undefined;
  const isError = subtype === 'error';
  return (
    <div style={isError ? styles.resultError : styles.resultOk}>
      {isError ? '✗ Error' : '✓ Done'}
    </div>
  );
}

function ErrorMessage({ event }: { event: ClaudeStreamEvent }) {
  return (
    <div style={styles.resultError}>
      ✗ {String(event.message ?? 'Unknown error')}
    </div>
  );
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
      .filter((b) => b.type === 'text')
      .map((b) => String(b.text ?? ''))
      .join('');
  }
  return '';
}

const styles: Record<string, React.CSSProperties> = {
  userBubble: {
    margin: '12px 0',
    padding: '10px 14px',
    background: 'var(--vscode-input-background)',
    borderRadius: '6px',
    borderLeft: '3px solid var(--vscode-focusBorder)',
  },
  assistantBubble: {
    margin: '12px 0',
    padding: '2px 0',
  },
  roleLabel: {
    display: 'block',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--vscode-descriptionForeground)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  userText: {
    fontSize: '13px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  markdown: {
    fontSize: '13px',
    lineHeight: 1.6,
  },
  toolBlock: {
    margin: '8px 0',
    padding: '8px 12px',
    background: 'var(--vscode-textBlockQuote-background)',
    borderRadius: '4px',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: '12px',
  },
  toolName: {
    display: 'block',
    fontWeight: 600,
    marginBottom: '4px',
    color: 'var(--vscode-descriptionForeground)',
  },
  toolInput: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: '11px',
    color: 'var(--vscode-foreground)',
  },
  resultOk: {
    fontSize: '12px',
    color: 'var(--vscode-testing-iconPassed)',
    padding: '4px 0 8px',
  },
  resultError: {
    fontSize: '12px',
    color: 'var(--vscode-testing-iconFailed)',
    padding: '4px 0 8px',
  },
};
