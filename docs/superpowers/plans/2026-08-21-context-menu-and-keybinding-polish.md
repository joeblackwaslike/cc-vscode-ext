# Context menu polish + dead keybinding fix

## Context

The final whole-branch review of the CLI-version-bump + session-groups + Focus-View branch
(merged to `main` at `508fa20`) parked six Minor findings as follow-up work rather than
extending that branch's fix loop further — none were load-bearing, but all are real, specified
issues worth closing out now. This plan addresses all six.

## Global constraints

- No new features, no scope beyond the six items below.
- Follow this repo's existing conventions: `webview-src/` React components use inline
  `React.CSSProperties` style objects or the shared `webview-src/styles.css`, matching whatever
  the touched file already does; extension-host TypeScript uses explicit return types, no `any`.
- Every behavioral change needs a test that would fail before the fix and pass after.

## Task 1 — Fix the dead `config.claudeCode.*` keybinding gate

`package.json`'s `contributes.keybindings` has three entries whose `when` clause leads with
`config.claudeCode.enableNewConversationShortcut && ...`: `claw-vscode.newConversation`,
`claw-vscode.reopenClosedSession`, and `claw-vscode.toggleFocusView` (the last one was already
partially fixed on the prior branch — verify its current state first, it should already have the
prefix removed). This extension never contributes a setting named `claudeCode.
enableNewConversationShortcut` via `contributes.configuration`, so the config lookup always
resolves to `undefined`/falsy and these keybindings can never fire.

Fix: add a real setting to `contributes.configuration` — e.g. `clawCode.
enableNewConversationShortcut` (boolean, default `true`, using this extension's own `clawCode.*`
namespace, not `claudeCode.*` which belongs to the official Anthropic extension) — and update
`newConversation`'s and `reopenClosedSession`'s `when` clauses to reference it. If
`toggleFocusView`'s `when` clause still has the dead prefix, remove it entirely (that binding was
never meant to be gated behind this setting — it's a new keybinding, not a legacy one being
preserved).

Files: `package.json` only.

## Task 2 — Context menu polish (delete-confirm safety, `keepOpen` on submenus, clamp re-run)

Three related issues in `webview-src/components/SessionContextMenu.tsx` /
`webview-src/components/SessionList.tsx` / `webview-src/styles.css`:

1. **Accidental double-click deletes a group with no perceivable confirmation.** The "Delete
   Group" → "Confirm delete "<name>"" label swap happens at the same screen position with no
   distinct styling, so a stray double-click on "Delete Group" can trigger the delete before the
   user registers the label changed. Fix: give the confirm state a visually distinct treatment
   (e.g. destructive/warning color via an existing `--vscode-*` error/warning CSS variable this
   codebase already references elsewhere) AND require the confirm click to land at least ~250ms
   after the row switched to confirm state (ignore an activation that arrives in the same tick
   as the swap) — pick whichever of these two mitigations is simpler given the current component
   structure; both are acceptable, but do at least the visual one.
2. **`ContextMenuItem.keepOpen` is silently ignored on submenu items.** Only top-level items
   honor it (`SessionContextMenu.tsx`); the submenu button unconditionally calls `onClose()`.
   Nothing exercises this today, but it's a footgun for the next `keepOpen` submenu item. Fix:
   honor `keepOpen` in the submenu item's click handler the same way the top-level handler does.
3. **The position-clamp effect doesn't re-run when the delete-confirm label swap widens the
   menu.** The `useLayoutEffect` clamping the menu's on-screen position has dependencies `[x, y,
   openSubmenu]` — it doesn't re-measure when a row's label changes width (e.g. a long group name
   in "Confirm delete "<name>""), so the menu can overflow the sidebar's right edge in that case.
   Fix: add whatever dependency captures the rendered item set/labels (e.g. the `items` array
   itself, or a derived key) so the clamp re-runs on that change too.

Also add the test the prior review flagged as missing: a test that arms delete-confirm on one
group, then opens a different group's context menu, and asserts the first group's confirm state
is not shown / did not leak (this is expected to already pass given the existing
`confirmDeleteGroupId === group.id` guard — the point is closing the coverage gap, not fixing a
live bug).

Files: `webview-src/components/SessionContextMenu.tsx`,
`webview-src/components/SessionList.tsx`, `webview-src/styles.css`,
`webview-src/components/SessionContextMenu.test.tsx`,
`webview-src/components/SessionList.test.tsx`.

## Task 3 — Create-group input UX (avoid scroll-jump)

`webview-src/components/SessionList.tsx`'s inline create-group input currently always renders as
a single shared row pinned to the top of the session list, regardless of which of the two trigger
sites opened it (plain "New Group" from empty-space/Ungrouped-header right-click, or "+ New
Group…" from the Move-to-Group accordion on a specific session's context menu). When triggered
from a session near the bottom of a long, scrolled list, the viewport jumps to the top to reveal
the input — reachable (autofocus scrolls it into view) but disorienting.

Fix: render the create-group input inline at the point of invocation instead of a fixed top-row —
specifically, when triggered from the Move-to-Group accordion, show the input as an additional
row directly within that accordion (replacing or appending to the "+ New Group…" row in place)
rather than jumping focus elsewhere in the list. When triggered from empty-space/Ungrouped-header
right-click (no natural in-place anchor), keep the existing top-of-list row behavior — that
trigger has no "near the bottom" case to jump away from. Preserve all existing behavior: Enter
commits, Escape cancels, blur commits, and the pending-move-after-create flow for the
accordion-triggered case still completes correctly.

Files: `webview-src/components/SessionList.tsx`, `webview-src/components/SessionList.test.tsx`.

## Verification

- `npm run typecheck` and `npm run typecheck:webview` clean.
- `npm run lint` clean.
- `npm test` (extension-host unit) and `npm run test:webview` fully green, including new tests
  for each fix above that fail before the fix and pass after.
- Manually confirm (if the extension can be run in this environment) that `Ctrl+Alt+F` now
  actually toggles Focus View, since Task 1 is what makes that true for the first time.
