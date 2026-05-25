import React, { useEffect, useState } from 'react';
import { postMessage } from '../lib/ipc';
import { useMessages } from '../hooks/useMessages';
import type { ToWebviewMessage } from '../lib/ipc';

interface Props {
  query: string;
  onSelect: (filePath: string) => void;
  onClose: () => void;
}

export function AtMentionDropdown({ query, onSelect, onClose }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    postMessage({ type: 'list_files_request', query });
  }, [query]);

  useMessages((msg: ToWebviewMessage) => {
    if (msg.type === 'list_files_response') {
      setFiles(msg.files);
      setSelected(0);
    }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        setSelected((n) => Math.min(n + 1, files.length - 1));
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        setSelected((n) => Math.max(n - 1, 0));
        e.preventDefault();
      } else if (e.key === 'Enter') {
        const file = files[selected];
        if (file) onSelect(file);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [files, selected, onSelect, onClose]);

  if (files.length === 0) return null;

  return (
    <div style={styles.container}>
      {files.map((file, i) => (
        <div
          key={file}
          style={{ ...styles.item, ...(i === selected ? styles.itemSelected : {}) }}
          onMouseEnter={() => setSelected(i)}
          onClick={() => onSelect(file)}
        >
          {file}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    maxHeight: '200px',
    overflowY: 'auto',
    background: 'var(--vscode-editorWidget-background)',
    border: '1px solid var(--vscode-editorWidget-border)',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    zIndex: 100,
  },
  item: {
    padding: '6px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    color: 'var(--vscode-foreground)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemSelected: {
    background: 'var(--vscode-list-activeSelectionBackground)',
    color: 'var(--vscode-list-activeSelectionForeground)',
  },
};
