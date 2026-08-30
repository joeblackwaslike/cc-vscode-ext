import { postMessage } from '../lib/ipc';

interface Props {
  onNewSession: () => void;
  authenticated: boolean;
  loginUrl: string | undefined;
}

export function WelcomeScreen({ onNewSession, authenticated, loginUrl }: Props) {
  if (!authenticated) {
    return (
      <div data-testid="welcome-screen" className="cc-welcome">
        <div className="cc-welcome__card">
          <div className="cc-welcome__mark">✻</div>
          <h2 className="cc-welcome__title">Sign in to Claude</h2>
          <p className="cc-welcome__sub">You need to sign in to use Clawd Code.</p>
          {loginUrl && (
            <button
              data-testid="sign-in-button"
              className="cc-btn cc-btn--primary"
              onClick={() => postMessage({ type: 'open_url', url: loginUrl })}
            >
              Sign In
            </button>
          )}
          <button
            data-testid="auth-cli-button"
            className="cc-btn cc-btn--secondary"
            onClick={() => postMessage({ type: 'login' })}
          >
            Authenticate with CLI
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="welcome-screen" className="cc-welcome">
      <div className="cc-welcome__card">
        <div className="cc-welcome__mark">✻</div>
        <h2 className="cc-welcome__title">Clawd Code</h2>
        <p className="cc-welcome__sub">Your AI coding partner</p>
        <button data-testid="new-session-button" className="cc-btn cc-btn--primary" onClick={onNewSession}>
          New Conversation
        </button>
        <p className="cc-welcome__hint">
          Ask Claude to write code, explain errors, or review your changes.
        </p>
      </div>
    </div>
  );
}
