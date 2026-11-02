# Open-file and selection context

Beads: session-relay-design-cyk (Parity P1), sub-project 1A
Roadmap: `~/.claude/plans/i-want-to-see-lexical-grove.md`, Phase 1. Checklist: `docs/parity.md`.
Reference behavior: official extension `anthropic.claude-code` 2.1.314 (read from its `extension.js` and `webview/index.js`).

## Problem

The official extension attaches the editor's open file and selected text to each prompt and shows what it will send as a chip in the composer. clawd does neither. Joe wants the same capability with an off-switch for the open file, because the official extension adds files he does not want in context.

Today the composer has no attachment concept (the only related entry is a disabled "Add image" item), a prompt is sent as a plain string, and nothing in the extension host listens to editor selection changes.

## How the official extension does it

The chat panel does not use the IDE WebSocket server. The host listens to editor events and posts the current file and selection to the webview. When the user sends a prompt, the webview adds extra text blocks to the message:

- With selected text: `<ide_selection>The user selected the lines S to E from <path>:` then the text, then `</ide_selection>`.
- With only an open file: `<ide_opened_file>The user opened the file <path> in the IDE. This may or may not be related to the current task.</ide_opened_file>`.

Selection updates are debounced by 300 ms. The chip has a remove button, and a removed selection does not come back until the selection changes. When a session is replayed, the tags are parsed back into chips.

## Goals

- The composer shows one removable chip at a time (the selection chip when text is selected, otherwise the file chip), and the prompt carries exactly what the chip shows.
- `clawdCode.attachOpenFile=false` removes the automatic open-file chip entirely.
- Past messages that contain these tags (from clawd or from the official extension) render as small chips, not raw tags glued to the prompt text.
- The behavior of the three official settings is matched: `attachOpenFile`, `attachSelection`, `respectGitIgnore`.

## Non-goals

- The IDE WebSocket server and lock file (sub-project 1B).
- `getDiagnostics` for the chat CLI (sub-project 1C).
- Image attach, `@browser`, and changes to the existing Alt+K @-mention feature.

## Anti-goals

- Selected text from a git-ignored or excluded file must never be sent when `respectGitIgnore` is on.
- With both attach settings off, nothing is attached and no chip shows.
- No visible chip can differ from what is sent. A selection chip sends its file and line range. Its text goes too, unless `respectGitIgnore` withholds it, and then the chip says the text is not included. A part whose setting was turned off after the chip appeared is dropped at send time.

## Settings

All three are declared under `clawdCode.*`, with `claudeCode.*` as a fallback when the clawd key is unset (the same chain `ExtensionSettings` uses elsewhere). They are not security-relevant, so workspace values are allowed.

| Setting | Default | Meaning |
|---|---|---|
| `clawdCode.attachOpenFile` | `true` | Attach the active editor's file when nothing is selected. When `false`, no bare open-file chip appears. |
| `clawdCode.attachSelection` | `true` | Attach selected text. When `false`, selected text is never attached, but a selection can still be added with Alt+K. |
| `clawdCode.respectGitIgnore` | `true` | Withhold selected text from files that are git-ignored or match `files.exclude`. The line range is still sent. `search.exclude` is not evaluated. |

Joe's settings already hold `claudeCode.attachOpenFile: false`, so the fallback gives him the off-switch with no further change.

With `attachOpenFile=false`, upstream still adds the open file when text is selected. Here the selection chip carries its own file path, since a selection needs one, and the bare open-file chip never appears. The two settings together:

| attachOpenFile | attachSelection | Nothing selected | Text selected |
|---|---|---|---|
| true | true | file chip | selection chip (with its file) |
| false | true | no chip | selection chip |
| true | false | file chip | file chip |
| false | false | no chip | no chip |

## Behavior

### Host: `EditorContextTracker`

A new class in `src/context/` listens to the active editor, selection changes (active editor only), document close and tab close (so the chip clears when no tab shows the file), and configuration changes. It computes the context to offer and posts it to every webview as a global message `ide_context`, debounced 300 ms and only when the value changed. The host applies the settings and the git-ignore rule, so the webview never needs the settings.

Only documents with the `file` scheme produce a context. Output channels, comment widgets, diff documents and untitled buffers produce none.

Context value: `null`, or `{ filePath, selection? }` where `filePath` is the absolute path and `selection` is `{ startLine, endLine, text?, truncatedChars? }` with 1-based lines. `text` is absent when the file is git-ignored or excluded and `respectGitIgnore` is on. `truncatedChars` is the number of characters cut from `text` by the size cap, and is absent when nothing was cut. The empty selection is `undefined`.

The git-ignore check runs `git check-ignore -q <path>` in the C locale, with the file's own directory as cwd. It takes an injected exec function, as `WorktreeManager` does. Four answers are settled: exit 0 means ignored, exit 1 means not ignored, git not installed (spawn error `ENOENT`) means not ignored, and exit 128 whose stderr says `not a git repository` means not ignored. Every other outcome withholds the text for that computation and is not cached: a timeout or kill, any other spawn failure such as `EACCES` or a missing working directory, any other exit 128 such as dubious repository ownership, any other exit code, and an exec rejection. The `files.exclude` probe follows the same rule. Its answer is cached, but a probe that throws or takes longer than 5 seconds withholds the text and is not cached. Settled answers are cached per path until the document closes, `files.exclude` changes, or the file system watcher reports a change to `.gitignore`. The tracker also recomputes when the tracked document's content changes, so the selected text is not stale.

At send time the host checks the context again before formatting it. It drops the selection when `attachSelection` is now off, drops a context with no selection when `attachOpenFile` is now off, and re-runs the ignore check, so text the webview still holds is dropped if the file became ignored since the last broadcast.

### Webview: chips and dismissal

The extension store holds the latest `ide_context`. `ChatInput` renders a chip row above the text area: one chip at a time: the selection chip (`basename:startLine-endLine`) when text is selected, otherwise the file chip (basename, full path in the tooltip). The chip has a remove button.

Removing a chip hides it for that composer until the underlying value changes. A new selection, a different file, or a closed document brings the chip back. This matches the official "remember the dismissed selection" behavior.

### Send

`ChatInput.onSend` passes the visible context along with the text. The `control_request` message gains an optional `context` field with `{ filePath, selection? }`. The host formats the tag blocks, so the wording lives in one tested place, and appends them to the user message as extra text blocks after the prompt text. The stream-json content becomes an array of text blocks when there is context and stays the plain string when there is none.

Text that starts with `/` is sent without context. Context is attached to every other send while the chip is visible. This mirrors the official extension. A later change could send only when the context changed.

The optimistic user turn that the app dispatches before the CLI echoes must carry the same blocks so the chips render at once.

During a session relay, queued prompts keep their context blocks.

### History and rendering

`pushUserTurn` in `webview-src/lib/conversationModel.ts` extracts `<ide_selection>` and `<ide_opened_file>` blocks from the user text blocks before joining them. The turn gains `ide?: { kind: 'file' | 'selection'; path: string; startLine?: number; endLine?: number }[]`, and `UserTurn` renders those as muted chips under the bubble. The tags no longer appear in the bubble text. This works the same for live turns, replayed clawd sessions and sessions written by the official extension.

## Risks and the first thing to verify

The CLI accepting a user message whose `content` is an array of text blocks is expected but not verified in this repo. The first implementation task is a live check against the real CLI (gated like the existing acceptance tests) that a prompt with an `<ide_opened_file>` block reaches the model. If the CLI rejects arrays, the fallback is to join the blocks into the string with a blank line, which loses the block boundary but keeps the tags.

## Test plan

1. Tag formatting: selection with and without text, file only, paths with spaces, `$` and backticks passed through unchanged, multi-line text preserved.
2. Tracker: file scheme only, active editor only, debounce, unchanged values not re-posted, each row of the settings table, ignored file omits `text` but keeps lines, git not installed, exit 1 and exit 128 outside a repository count as not ignored, and timeouts, kills, other spawn failures, other exit-128 errors, rejections, unrecognized exits and failed or hung `files.exclude` probes withhold text without caching. The send-time check applies the current attach settings.
3. Settings fallback: `claudeCode.attachOpenFile: false` turns off the file chip when the clawd key is unset, and an explicit clawd value wins.
4. Composer: chips render from `ide_context`, remove hides, a changed value restores, send carries exactly the visible chips, a dismissed chip is not sent.
5. Broker and process manager: `control_request` with context produces the array content, without context produces the string, relay queueing keeps the blocks.
6. Parser and turn rendering: tags from clawd and from official-extension sessions become chips and leave the bubble text clean.
7. Live round trip against the real CLI: a prompt with the blocks reaches the model (the model can repeat the path), for both a file context and a selection context.

## Files expected to change

New: `src/context/EditorContextTracker.ts`, `src/shared/ideTags.ts` (tag formatting and parsing shared by host and webview), `src/shared/userContent.ts` (builds the user message content from the prompt and the context), `webview-src/components/ContextChips.tsx`. Changed: `package.json`, `src/extension.ts`, `src/settings/ExtensionSettings.ts`, `src/ipc/MessageBroker.ts`, `src/process/ClaudeProcessManager.ts`, `src/relay/SessionRelayManager.ts`, `src/types/ipc.ts`, `webview-src/App.tsx`, `webview-src/components/ChatInput.tsx`, `webview-src/components/UserTurn.tsx`, `webview-src/lib/conversationModel.ts`, `webview-src/store/extensionStore.ts`, `test/helpers/mockVscode.ts`, and the matching tests.

## Details settled after the builder check

- **Focus leaving the editor.** The tracker keeps the last `file`-scheme editor's context until that document closes. Moving focus to the composer, an output channel or a diff does not clear the chip. A different `file` editor replaces it.
- **Withheld selection text.** When `text` is withheld, the host still sends an `<ide_selection>` block, containing `The user selected the lines S to E from <path>. The selected text was not included because the file is git-ignored or excluded.` The parser recognizes both the text form and the withheld form. The composer chip marks the withheld form with "(lines only)", and its tooltip reads `text not included (git-ignored, excluded, or could not be verified)`, which also covers a probe that failed or timed out. Each unsettled probe is logged with the path and the reason.
- **What counts as ignored.** A file is ignored when `git check-ignore -q <path>` exits 0, run with the file's own directory as cwd (so files outside the workspace but inside some repository are still checked), or when a `workspace.findFiles` probe for that exact path returns nothing because `files.exclude` hides it. `search.exclude` is not evaluated, because VS Code has no public matcher for it and the spec avoids a glob dependency. A file outside any git repository is not ignored.
- **Size cap.** Selected text over 50,000 characters is cut at 50,000 and the block ends with `[truncated N characters]`. The chip shows the full line range.
- **Optimistic turn.** Pure tag formatting and parsing live in `src/shared/ideTags.ts` with no `vscode` import. The webview imports it, so the optimistic user event carries the same raw blocks the CLI would echo, and `pushUserTurn` parses live, optimistic and replayed turns the same way. If the webview build cannot import from `src/`, the helper is duplicated with a test that pins both copies to the same outputs.
- **Relay queue and process swaps.** Queued prompts and `outstandingTurns` keep the context blocks captured at send time. They are not refreshed on replay.
- **New webview.** When a webview signals ready, the broker sends it the tracker's current value, so a panel opened after the last editor event still shows its chips.
- **Dismissal identity.** A chip counts as changed when its file path or line range changes. A text-only difference does not restore a dismissed chip.

## Left to the builder

File and component names beyond those listed, chip styling, the cache structure for the git-ignore check, and whether the tag helpers are shared between host and webview.

## Calls made without Joe

- Only `file`-scheme documents provide context.
- Context is attached on every send while visible (mirrors upstream), with send-on-change left as a possible follow-up.
- The host applies the settings and the webview is display-only.
- A selection chip names its file even when `attachOpenFile` is off.
- The three settings allow workspace values, because they do not grant any capability.
- Absolute paths go into the tags, and chips show the basename.
- The tracker keeps the last file editor until its document closes.
- Withheld text is announced in the tag, selected text is capped at 50,000 characters, and `search.exclude` is not evaluated.
- Context is attached as captured at send time, including through relay queueing.
