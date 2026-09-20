import { useEffect, useRef, useState, useCallback } from 'react';
import type { SessionInfo } from '../lib/ipc';

interface Props {
  sessions: SessionInfo[];
  onOpen: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  /** When true, the panel is always visible (empty-state mode). */
  inline?: boolean;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return new Date(iso).toLocaleDateString();
}

/** Clock button (in tab bar) or always-open panel (inline/empty-state). */
export function PastConversationsDropdown({ sessions, onOpen, onDelete, onRename, inline = false }: Props) {
  const [open, setOpen] = useState(inline);
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || inline) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, inline]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const visible = sessions
    .filter((s) => !s.hidden)
    .filter((s) => !query || (s.title ?? '').toLowerCase().includes(query.toLowerCase()));

  const openSession = useCallback((id: string) => {
    onOpen(id);
    if (!inline) setOpen(false);
    setQuery('');
  }, [onOpen, inline]);

  const startRename = useCallback((s: SessionInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(s.id);
    setRenameValue(s.title ?? '');
  }, []);

  const commitRename = useCallback((id: string) => {
    const t = renameValue.trim();
    if (t) onRename(id, t);
    setRenamingId(null);
  }, [renameValue, onRename]);

  const panel = (
    <div className={`cc-hist-panel${inline ? ' cc-hist-panel--inline' : ''}`} data-testid="history-panel">
      <div className="cc-hist-search-wrap">
        <input
          ref={searchRef}
          className="cc-hist-search"
          placeholder="Search conversations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (inline ? setQuery('') : setOpen(false))}
        />
      </div>
      <div className="cc-hist-list">
        {visible.length === 0 && (
          <div className="cc-hist-empty">{query ? 'No matches' : 'No past conversations'}</div>
        )}
        {visible.map((s) => {
          const label = s.title || 'Untitled';
          return (
            <div
              key={s.id}
              className="cc-hist-item"
              role="button"
              tabIndex={0}
              onClick={() => renamingId !== s.id && openSession(s.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' && renamingId !== s.id) openSession(s.id); }}
            >
              <button
                type="button"
                className="cc-hist-action cc-hist-rename-btn"
                title="Rename"
                onClick={(e) => startRename(s, e)}
              >
                ✎
              </button>
              {renamingId === s.id ? (
                <input
                  className="cc-hist-rename"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(s.id); }
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={() => commitRename(s.id)}
                />
              ) : (
                <span className="cc-hist-title" title={label}>{label}</span>
              )}
              <span className="cc-hist-time">{timeAgo(s.updatedAt)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (inline) return panel;

  return (
    <div className="cc-hist-wrap" ref={wrapRef}>
      <button
        className="cc-hist-trigger"
        data-testid="history-button"
        title="Conversation history"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3.5a.5.5 0 01.5.5v3.25l2.13 1.23a.5.5 0 11-.5.866L7.75 8.87A.5.5 0 017.5 8.5V5a.5.5 0 01.5-.5z"/>
        </svg>
      </button>
      {open && panel}
    </div>
  );
}
