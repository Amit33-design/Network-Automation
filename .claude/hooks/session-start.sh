#!/bin/bash
# SessionStart hook — prepares the repo so tests/linters work in Claude Code
# web sessions. Installs frontend dependencies (idempotent). Runs synchronously
# so the session starts from a known-ready state (no race conditions).
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
FRONTEND_DIR="$PROJECT_DIR/frontend"

if [ -d "$FRONTEND_DIR" ]; then
  cd "$FRONTEND_DIR"
  # Prefer `npm install` over `npm ci` so the cached container state is reused
  # across sessions (ci wipes node_modules every time).
  npm install --no-audit --no-fund
fi

echo "Frontend deps ready. Run tests with: cd frontend && npm test"
