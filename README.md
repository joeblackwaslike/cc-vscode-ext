# Claw Code

A clean, documented, ground-up reimplementation of the Claude Code VS Code extension.

Claw Code drives the real [`claude` CLI](https://github.com/anthropics/claude-code) behind a
from-scratch webview UI — same underlying agent, independent implementation of everything
above it. Built as a readable reference for how a Claude Code–style editor integration works,
and as a usable extension in its own right.

## Features

- **Chat with Claude directly in the editor** — ask questions, request changes, or get help
  understanding your code, with full access to read files, make edits, and run terminal
  commands in your workspace.
- **`@` file mentions** to pull specific files or folders into context, plus the ability to
  highlight a selection and ask about it directly.
- **Session management** — conversations are saved automatically; browse past sessions, resume
  where you left off, and organize sessions into named groups via the sidebar.
- **Diff review** — proposed edits render as an inline diff you can accept or reject before
  they land.
- **Run-in-terminal** — shell commands Claude suggests in a code block get a one-click Run
  button, with output streamed back into the conversation.
- **Focus View** — collapse routine tool-call activity into an expandable per-turn summary, so
  a busy session reads as a clean narrative instead of a wall of tool calls.
- **Drop-in command compatibility** — when the official Anthropic extension isn't installed,
  Claw Code answers its command IDs and keybindings too, so existing muscle memory and saved
  workflows keep working.

## Requirements

- VS Code 1.94.0 or later.
- A [Claude Code](https://claude.com/claude-code) account. The `claude` CLI binary is
  downloaded automatically on first run — nothing to install manually.

## Getting Started

1. Install the extension.
2. Click the Claw Code icon in the editor toolbar, or run **Claw Code: Open** from the Command
   Palette.
3. Sign in when prompted, then start chatting.

The built-in walkthrough (**Help → Get Started → Claw Code**) covers the basics interactively.

## Why a reimplementation?

Claw Code exists as a clean, from-scratch counterpart to the official extension — independently
built, openly documented, and free to diverge or experiment where the official extension can't.
It's designed to coexist peacefully: install both, and Claw Code detects the official extension
and steps out of its way rather than fighting over command IDs.

## Development

```bash
git clone https://github.com/joeblackwaslike/cc-vscode-ext.git
cd cc-vscode-ext
npm install
npm run build
```

Press F5 in VS Code to launch an Extension Development Host. See
[docs/](https://github.com/joeblackwaslike/cc-vscode-ext/tree/main/docs) for architecture notes,
and open an issue or PR — contributions welcome.

## License

[MIT](LICENSE) © Joe Black
