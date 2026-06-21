import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderMarkdown } from '../lib/markdown';
import { ToolCall } from './ToolCall';
import { CommandOutput } from './CommandOutput';
import { useRunCommand } from './RunOutputContext';
import type { AssistantBlock } from '../lib/conversationModel';

/** Decode a base64 `data-cc-cmd` attribute back into the raw command string. */
function decodeCommand(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      ta.remove();
    }
  }
}

/**
 * Renders an assistant text block as markdown (via `dangerouslySetInnerHTML`)
 * and augments shell code blocks: a delegated click listener drives the
 * Run/Copy toolbar buttons emitted by the markdown highlighter, and a React
 * `CommandOutput` panel is mounted into each block's `.cc-run-slot` via a portal
 * once the user runs it. Output state is keyed by execId in RunOutputContext, so
 * it survives the innerHTML rebuilds that happen while the message streams.
 */
function MarkdownText({
  block,
  blockKey,
  channelId,
}: {
  block: { text: string };
  blockKey: number;
  channelId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runCommand = useRunCommand();
  const [slots, setSlots] = useState<{ el: HTMLElement; key: string }[]>([]);
  const [execIds, setExecIds] = useState<Map<string, string>>(() => new Map());

  // After each (re)render of the markdown HTML, tag shell blocks with a stable
  // key and collect their output slots for portal mounting. The key includes
  // channelId so a reused AssistantTurn instance (tab switch — turn keys are
  // event indexes) can't surface one conversation's output under another's.
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const next: { el: HTMLElement; key: string }[] = [];
    root.querySelectorAll<HTMLElement>('.cc-codeblock').forEach((cb, ordinal) => {
      const key = `${channelId}:${blockKey}:${ordinal}`;
      cb.dataset.ccKey = key;
      const slot = cb.querySelector<HTMLElement>('.cc-run-slot');
      if (slot) next.push({ el: slot, key });
    });
    setSlots(next);
  }, [block.text, blockKey, channelId]);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const runBtn = target.closest<HTMLElement>('.cc-run-btn');
      const copyBtn = target.closest<HTMLElement>('.cc-copy-btn');
      if (!runBtn && !copyBtn) return;
      const cb = target.closest<HTMLElement>('.cc-codeblock');
      if (!cb) return;
      const command = decodeCommand(cb.dataset.ccCmd ?? '');
      if (copyBtn) {
        void copyToClipboard(command);
        copyBtn.textContent = '✓';
        setTimeout(() => {
          copyBtn.textContent = '⧉';
        }, 1200);
        return;
      }
      const key = cb.dataset.ccKey;
      if (!key) return;
      const execId = runCommand(command);
      setExecIds((prev) => new Map(prev).set(key, execId));
    },
    [runCommand],
  );

  return (
    <>
      <div
        ref={containerRef}
        className="cc-markdown"
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }}
      />
      {slots.map((s) => {
        const execId = execIds.get(s.key);
        return execId ? createPortal(<CommandOutput execId={execId} />, s.el, s.key) : null;
      })}
    </>
  );
}

/** An assistant turn — green dot gutter, then markdown text + tool calls. */
export function AssistantTurn({
  blocks,
  channelId,
}: {
  blocks: AssistantBlock[];
  channelId: string;
}) {
  return (
    <div className="cc-assistant" data-testid="chat-message-assistant">
      <div className="cc-assistant__gutter">
        <span className="cc-assistant__dot" />
      </div>
      <div className="cc-assistant__body">
        {blocks.map((block, i) =>
          block.type === 'text' ? (
            <MarkdownText key={i} block={block} blockKey={i} channelId={channelId} />
          ) : (
            <ToolCall key={i} tool={block} />
          ),
        )}
      </div>
    </div>
  );
}
