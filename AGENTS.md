# cc-vscode-ext Agent Instructions

## Deploy After Completing a Task

After committing and pushing a completed fix, feature, or change, run the full deploy sequence to make it live in VS Code Insiders:

```bash
npm run build && npx @vscode/vsce package --no-dependencies && code-insiders --install-extension "$(find . -maxdepth 1 -name 'clawd-code-*.vsix' | sort -V | tail -1)"
```

Run this once per completed task, after the commit — not after every individual file edit.
