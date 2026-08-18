/**
 * keep in sync with anti-compact/hooks/precompact-handoff.mjs @ ff10814
 * (SYSTEM_PROMPT constant). anti-compact uses this as a --system-prompt for
 * an isolated `claude -p` judge process fed the transcript as input; here it
 * is injected as a normal user turn into the live process instead (this repo
 * already owns that process's stdin, so no second process is needed).
 */
export const HANDOFF_SYSTEM_PROMPT = `You are creating a session handoff document. The session is about to be interrupted.

Produce a structured handoff that preserves ALL important context so work can continue seamlessly in a new session. Include:
- Original task and overall goal
- Key decisions made and WHY (rationale matters, not just what was decided)
- Current state: what's done, what's in progress, what's blocked
- Specific commands, file paths, issue IDs (never generalize these — list them exactly)
- Any mistakes encountered and their solutions
- Next concrete steps with specific issue IDs or commands

Be thorough. This handoff must preserve more context than an automated summary.

CONVERSATION:`;
