import React, { useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AtMentionDropdown } from './AtMentionDropdown';
import { SlashCommandDropdown } from './SlashCommandDropdown';
import { ComposerMenu, type MenuOption } from './ComposerMenu';
import { ContextUsageRing } from './ContextUsageRing';
import { ExtensionContext } from '../store/extensionStore';
import { postMessage } from '../lib/ipc';
import type { PermissionMode, ThinkingLevel, ContextUsage } from '../lib/ipc';

interface Props {
  channelId: string;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onCompact: () => void;
  onRefreshUsage?: (() => void) | undefined;
  running: boolean;
  usage?: ContextUsage | undefined;
  disabled?: boolean;
}

const MAX_HEIGHT = 168;

const MODE_OPTIONS: MenuOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'default', label: 'Ask permissions' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan mode' },
  { value: 'bypassPermissions', label: 'Bypass permissions' },
];
const BASE_MODEL_OPTIONS: MenuOption[] = [
  { value: '',                  label: 'Default' },
  { value: 'opus',              label: 'Opus',     hint: 'claude-opus-5' },
  { value: 'sonnet',            label: 'Sonnet',   hint: 'claude-sonnet-5' },
  { value: 'haiku',             label: 'Haiku',    hint: 'claude-haiku-4-5' },
  { value: 'claude-fable-5',    label: 'Fable 5' },
  { value: 'claude-opus-5',     label: 'Opus 5' },
  { value: 'claude-sonnet-5',   label: 'Sonnet 5' },
  { value: 'claude-opus-4-8',   label: 'Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5',  label: 'Haiku 4.5' },
];
const EFFORT_OPTIONS: MenuOption[] = [
  { value: 'low', label: 'Low', hint: 'faster' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max', hint: 'smarter' },
];
const PLUS_OPTIONS: MenuOption[] = [
  { value: 'add-files', label: 'Add files', hint: '@' },
  { value: 'slash', label: 'Slash commands', hint: '/' },
  { value: 'add-image', label: 'Add image', hint: 'soon', disabled: true },
];

const labelFor = (options: MenuOption[], value: string): string =>
  options.find((o) => o.value === value)?.label ?? value;

export function ChatInput({ channelId, onSend, onInterrupt, onCompact, onRefreshUsage, running, usage, disabled }: Props) {
  const ext = useContext(ExtensionContext);
  const state = ext?.state;
  const [text, setText] = useState('');
  const [mention, setMention] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with content up to MAX_HEIGHT, then scroll. Runs on every value change
  // (including reset to '' after send), fixing the old fixed-height clipping.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed && !running) {
      onSend(trimmed);
      setText('');
    }
  }, [text, running, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Skip while an IME is composing (Japanese/Chinese/Korean etc.) — Enter
      // there commits the candidate, it should not send a half-typed message.
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    const lastAt = val.lastIndexOf('@');
    if (lastAt !== -1) {
      const afterAt = val.slice(lastAt + 1);
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        setMention(afterAt);
        return;
      }
    }
    setMention(null);
    if (val.startsWith('/')) {
      setSlashQuery(val.slice(1));
    } else {
      setSlashQuery(null);
    }
  }, []);

  const handleMentionSelect = useCallback(
    (filePath: string) => {
      setText((prev) => {
        const lastAt = prev.lastIndexOf('@');
        return prev.slice(0, lastAt + 1) + filePath + ' ';
      });
      setMention(null);
      textareaRef.current?.focus();
    },
    [],
  );

  const insert = useCallback((ch: string) => {
    setText((prev) => prev + ch);
    if (ch === '@') setMention('');
    if (ch === '/') setSlashQuery('');
    textareaRef.current?.focus();
  }, []);

  const handleSlashSelect = useCallback((cmd: string) => {
    setText('/' + cmd + ' ');
    setSlashQuery(null);
    textareaRef.current?.focus();
  }, []);

  const onPlus = useCallback(
    (action: string) => {
      if (action === 'add-files') insert('@');
      else if (action === 'slash') insert('/');
    },
    [insert],
  );

  const mode = (state?.defaultPermissionMode ?? 'default') as PermissionMode;
  const effort = (state?.thinkingLevel ?? 'medium') as ThinkingLevel;
  const model = state?.model ?? '';
  const focusViewEnabled = state?.focusViewEnabled ?? false;
  const customModels = state?.customModels ?? [];
  const MODEL_OPTIONS: MenuOption[] = [
    ...BASE_MODEL_OPTIONS,
    ...customModels.map((id) => ({ value: id, label: id })),
  ];

  const dispatch = ext?.dispatch;

  const setMode = useCallback(
    (value: string) => {
      dispatch?.({ type: 'SET_DEFAULTS', defaults: { defaultPermissionMode: value as PermissionMode } });
      postMessage({ type: 'set_permission_mode', channelId, mode: value as PermissionMode });
    },
    [channelId, dispatch],
  );
  const setEffort = useCallback(
    (value: string) => {
      dispatch?.({ type: 'SET_DEFAULTS', defaults: { thinkingLevel: value as ThinkingLevel } });
      postMessage({ type: 'set_thinking_level', level: value as ThinkingLevel, channelId });
    },
    [channelId, dispatch],
  );
  const setModel = useCallback(
    (value: string) => {
      dispatch?.({ type: 'SET_DEFAULTS', defaults: { model: value } });
      postMessage({ type: 'set_model', model: value, channelId });
    },
    [channelId, dispatch],
  );
  // Optimistic flip so the toolbar toggle feels instant; the host's
  // `update_state` echo (driven by ViewManager.toggleFocusView(), the same
  // path the command/keybinding trigger uses) converges every webview.
  const toggleFocusView = useCallback(() => {
    dispatch?.({ type: 'SET_DEFAULTS', defaults: { focusViewEnabled: !focusViewEnabled } });
    postMessage({ type: 'toggle_focus_view' });
  }, [dispatch, focusViewEnabled]);

  return (
    <div className="cc-composer-wrap">
      {mention !== null && (
        <AtMentionDropdown query={mention} onSelect={handleMentionSelect} onClose={() => setMention(null)} />
      )}
      {slashQuery !== null && (
        <SlashCommandDropdown
          query={slashQuery}
          onSelect={handleSlashSelect}
          onClose={() => setSlashQuery(null)}
        />
      )}
      <div className={`cc-composer${focused ? ' cc-composer--focus' : ''}`}>
        <textarea
          data-testid="message-input"
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={running ? 'Claude is thinking…' : 'Message Claude… (@ to mention files)'}
          disabled={disabled}
          rows={1}
          className="cc-textarea"
        />
        <div className="cc-toolbar">
          {/* "+" anchored in the left corner, where it has always lived */}
          <ComposerMenu
            options={PLUS_OPTIONS}
            onSelect={onPlus}
            triggerLabel="＋"
            showChevron={false}
            triggerClass="cc-tbtn--plus"
            triggerTestId="composer-add-button"
            triggerTitle="Add files / slash commands"
          />
          <ComposerMenu
            options={MODE_OPTIONS}
            value={mode}
            onSelect={setMode}
            triggerLabel={labelFor(MODE_OPTIONS, mode)}
            triggerClass={mode === 'bypassPermissions' ? 'cc-tbtn--mode' : ''}
            triggerTestId="mode-selector"
            triggerTitle="Permission mode"
          />
          <button
            type="button"
            className={`cc-tbtn${focusViewEnabled ? ' cc-tbtn--active' : ''}`}
            onClick={toggleFocusView}
            data-testid="focus-view-toggle"
            title="Toggle Focus View"
          >
            Focus
          </button>
          <span className="cc-toolbar__sp" />
          <ComposerMenu
            options={MODEL_OPTIONS}
            value={model}
            onSelect={setModel}
            align="right"
            triggerLabel={labelFor(MODEL_OPTIONS, model)}
            triggerTestId="model-selector"
            triggerTitle="Model"
          />
          <ComposerMenu
            options={EFFORT_OPTIONS}
            value={effort}
            onSelect={setEffort}
            align="right"
            triggerLabel={labelFor(EFFORT_OPTIONS, effort)}
            triggerTestId="effort-selector"
            triggerTitle="Reasoning effort"
          />
          {usage && <ContextUsageRing usage={usage} onCompact={onCompact} onRefresh={onRefreshUsage} />}
          {running ? (
            <button data-testid="interrupt-button" className="cc-stop" onClick={onInterrupt} title="Stop">
              <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true">
                <rect x="3" y="3" width="10" height="10" rx="1.5"/>
              </svg>
            </button>
          ) : (
            <button
              data-testid="send-button"
              className="cc-send"
              style={{ opacity: text.trim() ? 1 : 0.4 }}
              onClick={submit}
              disabled={!text.trim() || disabled}
              title="Send (Enter)"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm.75 4.56l3.22 3.22a.75.75 0 11-1.06 1.06L9 6.94V12a.75.75 0 01-1.5 0V6.94L5.59 8.84a.75.75 0 11-1.06-1.06l3.22-3.22a.75.75 0 011.06 0z"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
