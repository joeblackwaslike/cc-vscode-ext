#!/usr/bin/env node
// Minimal stand-in for the `claude` CLI in `--input-format stream-json` mode.
// It encodes the ONE rule the real CLI enforces (verified empirically against
// claude 2.1.168): a user turn's `message` must be an object with role 'user'
// and string content. A bare-string message is rejected exactly like the real
// CLI ("Expected message role 'user', got 'undefined'") and yields no response.
import { createInterface } from 'node:readline';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

emit({ type: 'system', subtype: 'init' });

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const m = msg && msg.message;
  if (msg && msg.type === 'user' && m && typeof m === 'object' && m.role === 'user') {
    const content = typeof m.content === 'string' ? m.content : '';
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: `pong:${content}` }] } });
    emit({ type: 'result', subtype: 'success' });
  } else {
    process.stderr.write("Error: Expected message role 'user', got 'undefined'\n");
    emit({ type: 'error', error: "Expected message role 'user', got 'undefined'" });
  }
});
