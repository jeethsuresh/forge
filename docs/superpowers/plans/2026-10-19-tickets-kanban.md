# Tickets Kanban Implementation Plan

> **For agentic workers:** Execute inline in this session. Domain tests first, then APIs, scheduler, UI, ship.

**Goal:** First-class per-project tickets with exclusive claims, DAG deps, Ops API, one internal auto-worker, and a global reorderable queue.

**Architecture:** SQLite `tickets` + `ticket_dependencies`; domain in `src/lib/tickets.ts`; scheduler in `src/lib/ticket-scheduler.ts` (injectable session spawner); Ops and dashboard routes call domain + drain; project mode + settings tab.

**Tech Stack:** Next.js App Router, Drizzle/better-sqlite3, Vitest, existing `--forge-*` UI kit.

## Global Constraints

- One internal ticket worker Forge-wide; Ops claims may run in parallel (one agent per ticket).
- Ready gate: blockers must be `done`. Followups depend on parent.
- Never `./deploy.sh` against Forge; redeploy via Ops.
- Catalog in `agent-ops-prompt.ts` and tools in `forge-agent/registry.ts` must stay in sync.

## File map

- Create: `src/lib/tickets.ts`, `src/lib/tickets.test.ts`, `src/lib/ticket-scheduler.ts`, `src/lib/ticket-scheduler.test.ts`, `src/lib/ticket-http.ts`, `src/lib/tickets-ops.test.ts`
- Create: Ops/dashboard ticket routes, `ProjectTicketsBoard.tsx`, `TicketQueueSettings.tsx`, project tickets page
- Modify: `schema.ts`, `db/index.ts`, `agent-session-source.ts`, `agent-session-lifecycle.ts`, `agent-runner.ts`, `agent-ops-prompt.ts`, `registry.ts`, `project-routes.ts`, `mode-status.ts`, `ProjectStudio.tsx`, `Sidebar.tsx`, `GlobalSettings.tsx`, `instrumentation.ts`

## Tasks

1. Schema + domain + unit tests (create, pickup exclusive, deps, cycle, followup, complete, release, queue reorder, claim-next)
2. Ops + dashboard routes + catalog + registry
3. Scheduler with fake spawner; hook terminal sessions and startup
4. Project kanban UI
5. Global ticket queue settings
6. Agent prompt rules, `./build.sh` + `./test.sh`, commit, merge, Ops redeploy
