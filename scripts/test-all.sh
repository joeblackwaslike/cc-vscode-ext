#!/usr/bin/env bash
set -euo pipefail

echo "=== BUILD ==="
npm run build

echo "=== BUILD:INTEGRATION ==="
npm run build:integration

echo "=== UNIT ==="
npm run test:unit

echo "=== INTEGRATION ==="
npm run test:integration

echo "=== E2E ==="
npm run test:e2e

echo "=== ALL TESTS PASSED ==="
