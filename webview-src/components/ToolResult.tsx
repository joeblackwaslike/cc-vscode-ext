import { useState } from 'react';
import type { RenderedResult } from '../lib/toolRegistry';
import { postMessage } from '../lib/ipc';

const COLLAPSE_AT_TEXT = 3;
const COLLAPSE_AT_OTHER = 15;
/** Read tool output is `cat -n` style: leading spaces, a number, then tab/→. */
const LINE_NUM = /^\s*(\d+)[\t→](.*)$/;

interface Props {
  result: RenderedResult;
}

export function ToolResult({ result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const lines = result.content.replace(/\n$/, '').split('\n');
  const collapseAt = result.mode === 'text' ? COLLAPSE_AT_TEXT : COLLAPSE_AT_OTHER;
  const overflow = lines.length > collapseAt;
  const shown = expanded ? lines : lines.slice(0, collapseAt);

  return (
    <div className="cc-tool__out">
      {result.mode === 'lines' && <LineNumbered lines={shown} />}
      {result.mode === 'diff' && <Diff lines={shown} />}
      {result.mode === 'text' && <pre className="cc-tool__text">{shown.join('\n')}</pre>}
      {overflow && (
        <div className="cc-tool__collapse-row">
          <button className="cc-tool__collapse" onClick={() => setExpanded((e) => !e)}>
            {expanded ? '▾ Show less' : `▸ Show ${lines.length - collapseAt} more lines`}
          </button>
          {result.mode === 'text' && (
            <button
              className="cc-tool__open-window"
              onClick={() => postMessage({ type: 'open_content', content: result.content, language: 'plaintext' })}
            >
              ↗ Open
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LineNumbered({ lines }: { lines: string[] }) {
  return (
    <div className="cc-tool__text" style={{ padding: '8px 0' }}>
      {lines.map((line, i) => {
        const m = LINE_NUM.exec(line);
        return (
          <div className="cc-ln" key={i}>
            <span className="cc-ln__gut">{m ? m[1] : ''}</span>
            <span className="cc-ln__txt">{m ? m[2] : line}</span>
          </div>
        );
      })}
    </div>
  );
}

function Diff({ lines }: { lines: string[] }) {
  return (
    <div className="cc-tool__text" style={{ padding: '8px 0' }}>
      {lines.map((line, i) => {
        const cls = line.startsWith('+') ? ' cc-ln--add' : line.startsWith('-') ? ' cc-ln--del' : '';
        return (
          <div className={`cc-ln${cls}`} key={i}>
            <span className="cc-ln__txt" style={{ paddingLeft: 12 }}>{line}</span>
          </div>
        );
      })}
    </div>
  );
}
