# Pluggable Agent Backends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Forge agent session run Cursor, Codex, or a Forge-owned local OpenAI-compatible agent, always pinned to extra-high/xhigh thinking.

**Architecture:** In-tree `AgentBackend` adapters supply container env/argv/binds. The existing per-turn `forge-agent` sandbox, Ops ingest, and Agents UI stay shared. Cursor/Codex CLIs remain host bind-mounts; local is a runtime in the agent image.

**Tech Stack:** TypeScript, Drizzle/SQLite, Docker/Podman agent image, Vitest, Next.js App Router.

## Global Constraints

- Adapters live in `src/lib/agent-backends/`, not `src/lib/forge-agent/`.
- Thinking: xhigh, then high, then none (local only). No UI toggle.
- Deploy succeeds if at least one backend is usable.
- Do not bind host Cursor/Codex config dirs into agent containers.
- Empty compose env must not create anonymous volumes (use stub dirs).
- Never run Forge `./deploy.sh` against the live stack; Ops/UI Redeploy after tests.

---

### Task 1: Types, thinking, schema, registry

**Files:**
- Create: `src/lib/agent-backends/types.ts`, `thinking.ts`, `thinking.test.ts`, `registry.ts`, `settings.ts`
- Modify: `src/lib/db/schema.ts`, `src/lib/db/index.ts`

- [ ] Thinking helper + tests (xhigh then high; Claude thinking-high; passthrough if already suffixed)
- [ ] Schema columns + `agent_backend_settings` table
- [ ] Registry `isAgentBackendId`, `pickDefaultBackend`, `getBackend`

### Task 2: Cursor extract + generic entrypoint

**Files:**
- Create: `src/lib/agent-backends/cursor.ts`
- Modify: `docker/agent/entrypoint.sh`, `src/lib/agent-container.ts`, `src/lib/agent-runner.ts`, `src/lib/agent-events-ingest.ts`

- [ ] Cursor adapter argv includes `--model` thinking variant and `--resume`
- [ ] Entrypoint uses `FORGE_AGENT_ARGS_JSON`; no hardcoded `--resume`
- [ ] Container mounts Cursor only when backend is cursor and a real binary exists

### Task 3: Picker, settings, deploy-if-any

**Files:**
- Create: settings API + `AgentBackendsSettings.tsx`
- Modify: session create APIs, `AgentWorkspace`, `useAgentWorkspace`, `common.sh`, `docker-compose.yml`, `deploy.sh`, `SETUP_GUIDE.md`

- [ ] Per-session backend select; recovery/bootstrap default
- [ ] `require_any_agent_backend` + stub binds

### Task 4: Codex adapter

**Files:**
- Create: `src/lib/agent-backends/codex.ts`, `codex.test.ts`
- Modify: host mounts, container binds

### Task 5: Local runtime

**Files:**
- Create: `src/lib/agent-backends/local.ts`, `local-loop.ts`, `docker/agent/local-runtime.mjs`
- Modify: `docker/agent/Dockerfile`

### Task 6: Verify

- [ ] `./test.sh`
- [ ] Ops redeploy
