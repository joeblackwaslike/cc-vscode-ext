#!/usr/bin/env node
// Minimal stand-in for the `claude` CLI in `--input-format stream-json` mode.
// It encodes the ONE rule the real CLI enforces (verified empirically against
// claude 2.1.168): a user turn's `message` must be an object with role 'user'
// and string content. A bare-string message is rejected exactly like the real
// CLI ("Expected message role 'user', got 'undefined'") and yields no response.
//
// It also has minimal control_request/control_response support for tests that
// need to drive a real ControlRequestManager against a real process:
//   - A user turn with content 'NEEDS_APPROVAL' simulates the CLI needing to
//     ask permission for a tool call mid-turn: instead of the normal
//     pong/result pair, it emits a `control_request` (subtype 'can_use_tool')
//     and never emits a `result` — the turn stays open, exactly like a real
//     tool call blocked on user approval.
//   - Incoming `control_request` lines (host -> CLI, e.g. get_context_usage)
//     are intentionally never answered — this fixture has no need to ack
//     them, and callers rely on that silence to keep
//     ControlRequestManager.hasPending() true for the life of a test.
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

  if (msg && msg.type === 'control_request') {
    // Deliberately left unanswered — see file header comment.
    return;
  }

  const m = msg && msg.message;
  if (
    msg &&
    msg.type === 'user' &&
    m &&
    typeof m === 'object' &&
    m.role === 'user' &&
    typeof m.content === 'string'
  ) {
    if (m.content === 'NEEDS_APPROVAL') {
      emit({
        type: 'control_request',
        request_id: 'fc_tool_req_1',
        request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'echo hi' } },
      });
      return;
    }
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: `pong:${m.content}` }] } });
    emit({ type: 'result', subtype: 'success' });
  } else {
    process.stderr.write("Error: Expected message role 'user', got 'undefined'\n");
    emit({ type: 'error', error: "Expected message role 'user', got 'undefined'" });
  }
});
