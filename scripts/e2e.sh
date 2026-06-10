#!/usr/bin/env bash
# Safe E2E runner. The trap is the outermost guarantee: no matter how Playwright
# exits — success, failure, Ctrl-C, or a hung process — every VS Code instance
# the suite spawned (tagged with the 'vscode-e2e-' user-data-dir marker) is
# killed before this script returns. Layered on top of the in-process cap and
# the globalSetup/globalTeardown sweeps.
set -euo pipefail

cleanup() { pkill -9 -f 'vscode-e2e-' 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Wall-clock guard so a hung run can't sit open forever. Prefer GNU timeout
# (gtimeout from brew coreutils on macOS); run without it if neither exists.
TO=""
if command -v timeout >/dev/null 2>&1; then
  TO="timeout ${E2E_TIMEOUT:-600}"
elif command -v gtimeout >/dev/null 2>&1; then
  TO="gtimeout ${E2E_TIMEOUT:-600}"
fi

rc=0
# shellcheck disable=SC2086
$TO npx playwright test --config playwright.e2e.config.ts "$@" || rc=$?
exit "$rc"
