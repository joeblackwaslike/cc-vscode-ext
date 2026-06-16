import { useState } from 'react';
import type { RenderedResult } from '../lib/toolRegistry';

const COLLAPSE_AT = 15;
/** Read tool output is `cat -n` style: leading spaces, a number, then tab/→. */
const LINE_NUM = /^\s*(\d+)[\t→](.*)$/;

interface Props {
  result: RenderedResult;
  isError: boolean;
}

export function ToolResult({ result, isError }: Props) {
  const [expanded, setExpanded] = useState(false);
  const lines = result.content.replace(/\n$/, '').split('\n');
  const overflow = lines.length > COLLAPSE_AT;
  const shown = expanded ? lines : lines.slice(0, COLLAPSE_AT);

  return (
    <div className={`cc-tool__out${isError ? ' cc-tool__out--error' : ''}`}>
      {result.mode === 'lines' && <LineNumbered lines={shown} />}
      {result.mode === 'diff' && <Diff lines={shown} />}
      {result.mode === 'text' && <pre className="cc-tool__text">{shown.join('\n')}</pre>}
      {overflow && (
        <button className="cc-tool__collapse" onClick={() => setExpanded((e) => !e)}>
          {expanded ? '▾ Show less' : `▸ Show ${lines.length - COLLAPSE_AT} more lines`}
        </button>
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
