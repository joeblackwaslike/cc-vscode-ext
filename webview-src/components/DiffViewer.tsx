import React from 'react';
import { postMessage } from '../lib/ipc';

/**
 * Placeholder diff viewer shown inside the session list webview
 * when a proposed diff is pending. The actual diff content is displayed
 * in VS Code's native diff editor (opened via `vscode.diff` command);
 * this component just offers accept/reject shortcuts.
 */
export function DiffViewer({ filePath }: { filePath?: string }) {
  return (
    <div style={styles.container}>
      <div style={styles.header}>Proposed Changes</div>
      {filePath && <div style={styles.filePath}>{filePath}</div>}
      <p style={styles.description}>
        Review the proposed changes in the diff editor above, then accept or reject:
      </p>
      <div style={styles.buttons}>
        <button
          style={styles.accept}
          onClick={() =>
            postMessage({ type: 'open_output_panel' })
          }
          title="Accept (claude-vscode.acceptProposedDiff)"
        >
          ✓ Accept
        </button>
        <button
          style={styles.reject}
          onClick={() =>
            postMessage({ type: 'close_channel', channelId: '' })
          }
          title="Reject (claude-vscode.rejectProposedDiff)"
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  header: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--vscode-foreground)',
  },
  filePath: {
    fontSize: '12px',
    color: 'var(--vscode-descriptionForeground)',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
  },
  description: {
    fontSize: '13px',
    color: 'var(--vscode-descriptionForeground)',
    margin: '4px 0',
  },
  buttons: {
    display: 'flex',
    gap: '8px',
    marginTop: '4px',
  },
  accept: {
    padding: '6px 16px',
    background: 'var(--vscode-testing-iconPassed)',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  reject: {
    padding: '6px 16px',
    background: 'var(--vscode-testing-iconFailed)',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
  },
};
