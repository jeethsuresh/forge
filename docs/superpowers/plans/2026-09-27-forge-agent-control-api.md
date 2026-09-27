# Forge Agent Control API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-knowledge HTTP harness can discover Forge via well-known/discover, search a shared tool registry, and mutate through existing Ops handlers over REST explorer or MCP JSON-RPC.

**Architecture:** Shared registry (tools/resources/prompts) plus envelope/search helpers. Explorer routes and `POST /api/ops/mcp` dispatch into the same exported Ops route functions. New Ops rebase/finalize wraps existing recovery cleanup. Public well-known + discover; live reads and `tools/call` stay Ops-auth.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, existing `ops-api-*` auth/audit, MCP JSON-RPC 2.0 subset (2025-06-18).

## Global Constraints

- Protocol id: `forge-agent/1`
- Do not remove existing `GET /api/ops` catalog keys or list payload keys (`projects`, `actions`)
- Mutations still require `actionDescription` (10–2000 chars) on real Ops routes
- Never run Forge’s own `./deploy.sh`; verify with `./test.sh`; redeploy via Ops
- Spec: `docs/superpowers/specs/2026-09-27-forge-agent-control-api-design.md`
- Session tokens stay project-scoped; bootstrap allowlist for list GET only (call restricted except when target path is already allowed)
- Exempt `/.well-known/forge-agent.json` from cookie session

## File structure

| File | Responsibility |
|------|----------------|
| `src/lib/forge-agent/types.ts` | Protocol types, tool/resource/prompt shapes |
| `src/lib/forge-agent/envelope.ts` | `protocol` / `self` / `search` / `next` helper |
| `src/lib/forge-agent/search.ts` | Ranked `?q=` over name, tags, path, description |
| `src/lib/forge-agent/registry.ts` | Shared tool/resource/prompt definitions |
| `src/lib/forge-agent/discover.ts` | Public well-known / discover document |
| `src/lib/forge-agent/dispatch.ts` | Schema check + invoke existing Ops route handlers |
| `src/lib/forge-agent/mcp.ts` | JSON-RPC 2.0 method router |
| `src/lib/forge-agent/*.test.ts` | Unit tests for the above |
| `src/app/.well-known/forge-agent.json/route.ts` | Public well-known |
| `src/app/api/ops/discover/route.ts` | Public alias |
| `src/app/api/ops/search/route.ts` | Unified search |
| `src/app/api/ops/tools/route.ts` | List tools |
| `src/app/api/ops/tools/[name]/route.ts` | One tool |
| `src/app/api/ops/tools/[name]/call/route.ts` | Authenticated dispatch |
| `src/app/api/ops/resources/route.ts` | List resources |
| `src/app/api/ops/resources/[name]/route.ts` | One resource / live read via `?read=1` or dedicated GET |
| `src/app/api/ops/prompts/route.ts` | List prompts |
| `src/app/api/ops/prompts/[name]/route.ts` | One prompt |
| `src/app/api/ops/mcp/route.ts` | POST JSON-RPC; GET 405 + next |
| `src/app/api/ops/projects/[id]/git-tree/rebase/finalize/route.ts` | Ops-auth finalize |
| `src/lib/ops-bootstrap-guard.ts` | Allowlist explorer list GET + MCP initialize/list |
| `src/lib/http-public-path.ts` | Well-known exemption |
| `src/lib/agent-ops-prompt.ts` | Catalog + first-turn prompt |
| `src/app/api/ops/route.ts` | Optional `?q=` + envelope siblings |
| `src/app/api/ops/projects/route.ts`, `actions/route.ts` | Sibling `next`/`search` |
| `src/lib/rebase-recovery.ts` | Ops finalize URL in recovery prompt |

---

### Task 1: Envelope, search, discover (lib)

**Files:**
- Create: `src/lib/forge-agent/types.ts`
- Create: `src/lib/forge-agent/envelope.ts`
- Create: `src/lib/forge-agent/search.ts`
- Create: `src/lib/forge-agent/discover.ts`
- Test: `src/lib/forge-agent/envelope.test.ts`

**Interfaces:**
- Produces: `FORGE_AGENT_PROTOCOL = "forge-agent/1"`
- `forgeAgentEnvelope({ self, search?, next, extra })`
- `rankForgeAgentHits(query, items)`
- `forgeAgentDiscoverDocument(baseUrl)`

- [x] Write failing tests, then implement (this run)

### Task 2: Registry

**Files:**
- Create: `src/lib/forge-agent/registry.ts`
- Test: `src/lib/forge-agent/registry.test.ts`

- [x] Every catalog Ops endpoint maps to a callable tool; dashboard tools not callable; rebase finalize present; prompts listed

### Task 3: Dispatch + MCP

**Files:**
- Create: `src/lib/forge-agent/dispatch.ts`
- Create: `src/lib/forge-agent/mcp.ts`
- Test: `src/lib/forge-agent/mcp.test.ts`

- [x] Dashboard call → 401/403 + next; missing auth on tools/call → unauthorized; initialize works without token; path expansion + handler invoke

### Task 4: Routes, bootstrap, prompt, finalize

**Files:** routes listed above; bootstrap; http-public-path; agent-ops-prompt; rebase-recovery; GET /api/ops

- [x] Public well-known; Ops finalize; prompt starts at discover; tests for allowlist + exemption

### Task 5: Verify, commit, merge, Ops redeploy

- [ ] `./test.sh`
- [ ] Commit on `agent/control-with-remote-ai`
- [ ] Merge to default trunk
- [ ] `POST /api/ops/projects/{id}/deploy` (never `./deploy.sh`)
