import React, { useEffect, useState } from 'react';
import { postMessage } from '../lib/ipc';
import { useMessages } from '../hooks/useMessages';
import type { ToWebviewMessage } from '../lib/ipc';

interface CommandEntry { name: string; namespace?: string; description?: string }

interface Props {
  query: string;
  onSelect: (cmd: string) => void;
  onClose: () => void;
}

export function SlashCommandDropdown({ query, onSelect, onClose }: Props) {
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    postMessage({ type: 'list_commands_request', query });
  }, [query]);

  useMessages((msg: ToWebviewMessage) => {
    if (msg.type === 'list_commands_response') {
      setCommands(msg.commands);
      setSelected(0);
    }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!commands.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(n => Math.min(n + 1, commands.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(n => Math.max(n - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); const c = commands[selected]; if (c) onSelect(c.namespace ? `${c.namespace}:${c.name}` : c.name); }
      else if (e.key === 'Escape') { onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [commands, selected, onSelect, onClose]);

  if (!commands.length) return null;

  let lastNs: string | undefined = undefined;
  return (
    <div className="cc-slash-dropdown">
      {commands.map((cmd, i) => {
        const fullName = cmd.namespace ? `${cmd.namespace}:${cmd.name}` : cmd.name;
        const nsHeader = cmd.namespace !== lastNs ? (lastNs = cmd.namespace, cmd.namespace) : null;
        return (
          <React.Fragment key={fullName}>
            {nsHeader && <div className="cc-slash-ns">{nsHeader}</div>}
            <div
              className={`cc-slash-item${i === selected ? ' cc-slash-item--active' : ''}`}
              onMouseDown={() => onSelect(fullName)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="cc-slash-name">/{fullName}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
