#!/usr/bin/env bash
# Build the extension into a .vsix and install it into VS Code Insiders.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v code-insiders >/dev/null 2>&1; then
  echo "error: 'code-insiders' is not on your PATH." >&2
  echo "In VS Code Insiders: Cmd+Shift+P -> \"Shell Command: Install 'code-insiders' command in PATH\"" >&2
  exit 1
fi

echo "Packaging extension..."
npm run package

vsix="$(ls -t ./*.vsix 2>/dev/null | head -n1 || true)"
if [ -z "${vsix:-}" ]; then
  echo "error: 'npm run package' produced no .vsix in the repo root." >&2
  exit 1
fi

echo "Installing ${vsix} into VS Code Insiders..."
code-insiders --install-extension "${vsix}" --force

echo "Done. Reload Insiders to pick it up: Cmd+Shift+P -> 'Developer: Reload Window'."
