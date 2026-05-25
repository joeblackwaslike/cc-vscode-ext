import React, { useRef, useState, useCallback } from 'react';
import { AtMentionDropdown } from './AtMentionDropdown';

interface Props {
  onSend: (text: string) => void;
  onInterrupt: () => void;
  running: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSend, onInterrupt, running, disabled }: Props) {
  const [text, setText] = useState('');
  const [mention, setMention] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (text.trim() && !running) {
          onSend(text.trim());
          setText('');
        }
      }
    },
    [text, running, onSend],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Detect @-mention trigger
    const lastAt = val.lastIndexOf('@');
    if (lastAt !== -1) {
      const afterAt = val.slice(lastAt + 1);
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        setMention(afterAt);
        return;
      }
    }
    setMention(null);
  }, []);

  const handleMentionSelect = useCallback(
    (filePath: string) => {
      const lastAt = text.lastIndexOf('@');
      const newText = text.slice(0, lastAt + 1) + filePath + ' ';
      setText(newText);
      setMention(null);
      textareaRef.current?.focus();
    },
    [text],
  );

  return (
    <div style={styles.container}>
      {mention !== null && (
        <AtMentionDropdown
          query={mention}
          onSelect={handleMentionSelect}
          onClose={() => setMention(null)}
        />
      )}
      <div style={styles.inputRow}>
        <textarea
          data-testid="message-input"
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={running ? 'Claude is thinking…' : 'Message Claude… (@ to mention files)'}
          disabled={disabled}
          rows={1}
          style={styles.textarea}
        />
        {running ? (
          <button data-testid="interrupt-button" style={styles.interruptButton} onClick={onInterrupt} title="Stop">
            ■
          </button>
        ) : (
          <button
            data-testid="send-button"
            style={{ ...styles.sendButton, opacity: text.trim() ? 1 : 0.4 }}
            onClick={() => {
              if (text.trim()) {
                onSend(text.trim());
                setText('');
              }
            }}
            disabled={!text.trim() || disabled}
            title="Send (Enter)"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    padding: '8px 12px 12px',
    borderTop: '1px solid var(--vscode-editorWidget-border)',
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end',
  },
  textarea: {
    flex: 1,
    resize: 'none',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '6px',
    padding: '8px 10px',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    maxHeight: '160px',
    lineHeight: 1.5,
    overflowY: 'auto',
  },
  sendButton: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  interruptButton: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'var(--vscode-statusBarItem-warningBackground)',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
};
