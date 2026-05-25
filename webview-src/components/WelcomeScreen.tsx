import React from 'react';
import { postMessage } from '../lib/ipc';

interface Props {
  onNewSession: () => void;
  authenticated: boolean;
  loginUrl: string | undefined;
}

export function WelcomeScreen({ onNewSession, authenticated, loginUrl }: Props) {
  if (!authenticated) {
    return (
      <div data-testid="welcome-screen" style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Sign in to Claude</h2>
          <p style={styles.subtitle}>You need to sign in to use Claude Code.</p>
          {loginUrl && (
            <button
              style={styles.primaryButton}
              onClick={() => postMessage({ type: 'open_url', url: loginUrl })}
            >
              Sign In
            </button>
          )}
          <button
            style={styles.secondaryButton}
            onClick={() => postMessage({ type: 'login' })}
          >
            Authenticate with CLI
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="welcome-screen" style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Claude Code</h2>
        <p style={styles.subtitle}>Your AI coding partner</p>
        <button style={styles.primaryButton} onClick={onNewSession}>
          New Conversation
        </button>
        <p style={styles.hint}>
          Ask Claude to write code, explain errors, or review your changes.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '24px',
  },
  card: {
    textAlign: 'center',
    maxWidth: '320px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    margin: '0 0 8px',
    color: 'var(--vscode-foreground)',
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--vscode-descriptionForeground)',
    margin: '0 0 24px',
  },
  primaryButton: {
    display: 'block',
    width: '100%',
    padding: '8px 16px',
    marginBottom: '8px',
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  secondaryButton: {
    display: 'block',
    width: '100%',
    padding: '8px 16px',
    marginBottom: '8px',
    background: 'var(--vscode-button-secondaryBackground)',
    color: 'var(--vscode-button-secondaryForeground)',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  hint: {
    fontSize: '12px',
    color: 'var(--vscode-descriptionForeground)',
    marginTop: '16px',
  },
};
