#!/bin/bash
# SessionStart hook — prepares the repo so tests/linters work in Claude Code
# web sessions. Installs frontend dependencies (idempotent) and sets git
# identity for verified commits. Runs synchronously so the session starts
# from a known-ready state (no race conditions).
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# ── Git identity (required for Vercel-verified commits) ──
cd "$PROJECT_DIR"
git config user.email "noreply@anthropic.com"
git config user.name "Claude"

# ── Frontend dependencies ──
FRONTEND_DIR="$PROJECT_DIR/frontend"

if [ -d "$FRONTEND_DIR" ]; then
  cd "$FRONTEND_DIR"
  npm install --no-audit --no-fund
fi

echo "Frontend deps ready. Run tests with: cd frontend && npm test"
