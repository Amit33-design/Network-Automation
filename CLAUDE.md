# NetDesign AI — Claude Instructions

## CRITICAL: Tool Restrictions

This is a **personal open-source project**. The following tools and services are
**STRICTLY FORBIDDEN** and must NEVER be used, referenced, or called for any task
in this project:

### Forbidden tools (Amazon-internal only)
- `builder-mcp` / `ReadInternalWebsites` / `InternalCodeSearch` / `InternalSearch`
- `aws-api-mcp` / `mcp__aws-api-mcp__*`
- `aws-knowledge-mcp-server-mcp` / `mcp__aws-knowledge-mcp-server-mcp__*`
- `aws-smithy-cloudwatch-mcp` / `mcp__aws-smithy-cloudwatch-mcp__*`
- `tickety-aws-mcp` / `mcp__tickety-aws-mcp__*`
- `regionflex-mcp` / `mcp__regionflex-mcp__*`
- `unified-operations-mcp` / `mcp__unified-operations-mcp__*`
- `orr-mcp` / `mcp__orr-mcp__*`
- `loaf_mcp` / `mcp__loaf_mcp__*`
- `coe-mcp` / `mcp__coe-mcp__*`
- `cornell-mcp` / `mcp__cornell-mcp__*`
- `software-builder-insights-prod-mcp` / `mcp__software-builder-insights-prod-mcp__*`
- Any tool with `amazon`, `aws-internal`, `isengard`, `midway`, `brazil`, or `a2z` in its name or URL

### Why
These are Amazon-internal corporate tools. This project has no affiliation with
Amazon. Using them would be a security/privacy violation.

### Allowed tools
Only use tools from this list:
- `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep` — standard file tools
- `WebSearch`, `WebFetch` — public internet only
- `mcp__netdesign-ai__*` — NetDesign AI's own MCP server
- `mcp__Claude_Preview__*` — browser preview
- `mcp__Claude_in_Chrome__*` — browser automation
- `mcp__computer-use__*` — desktop automation
- `RemoteTrigger`, `CronCreate`, `TodoWrite` — scheduling/tasks
- `Agent` — spawning sub-agents

---

## Project Overview

**NetDesign AI** — browser-native 6-step network design wizard.

- **Repo**: https://github.com/Amit33-design/Network-Automation (branch: `main`)
- **Live**: Vercel (frontend) + Railway (backend)
- **Stack**: Plain global JS (no ES modules, no build step) + FastAPI Python 3.11

## Tech Constraints (non-negotiable)

1. **Global JS only** — no `export`, `import`, `require`. Expose via `window.fnName`
2. **`'use strict'`** at top of every `.js` file
3. **No npm/webpack/bundler** for browser code
4. **No new CDN dependencies** without explicit user approval
5. **Backend**: FastAPI + Pydantic v2, async handlers
6. **Branch**: Always work on `main`, never `master`
7. **Commits**: conventional format — `feat:`, `fix:`, `chore:`, `docs:`
8. **No breaking changes** to existing use cases: campus/dc/gpu/wan/multisite/multicloud/aviatrix

## Autonomous Agent Rules

When running as the scheduled autonomous agent:

1. First command every run: `git fetch origin && git checkout main && git pull origin main`
2. Read `AGENT_ROADMAP.md` to find the next unchecked `[ ]` Tier-1 feature
3. Implement fully before committing — no partial implementations
4. Close the GitHub issue after committing: `gh issue close <N> --repo Amit33-design/Network-Automation`
5. Update `AGENT_ROADMAP.md` Agent Log with a timestamped entry
6. **Never use any forbidden tool listed above**
