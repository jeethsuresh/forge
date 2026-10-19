# Forge tickets (kanban + agent pickup)

**Date:** 2026-10-19  
**Status:** Approved for implementation  
**Related:** agent sessions, Ops catalog, global settings

## Problem

Forge has agents and deploys but no first-class work tracker. Humans cannot queue project work for agents; agents cannot exclusively claim a unit of work; follow-up work has no dependency graph.

## Goal

Per-project kanban tickets that humans create and agents claim. One agent per ticket. One Forge-wide internal auto-worker. API-token agents may claim in parallel. Followups depend on their parent. Full Ops surface.

## Decisions

- Tickets are SQLite rows, not git files and not `agent_sessions`.
- Same ticket pool for internal and Ops agents.
- Per-project board; global settings **Ticket queue** for internal-worker order.
- Ready = `todo`, unclaimed, every dependency `done`. Same-project deps only.
- Pickup → `in_progress`. Complete → `done`. Session exit does not complete a ticket.
- Internal worker: at most one live `claimedByKind=internal` ticket. Spawns `source=ticket` session on `ticket/<8-char-id>`.
- Ops pickup does not spawn a container.
- Kanban columns are not freely dragged; status changes via pickup / complete / release.

## Non-goals (v1)

Parallel internal workers, ticket types, comments, a Blocked column, auto-deploy on complete, cross-project dependencies.

## Data

`tickets` (project-scoped, `number`, title, description, status, `queueRank`, claim fields, branch, agentSessionId) and `ticket_dependencies` (`ticketId` depends on `dependsOnTicketId`). `agent_sessions.ticket_id` and source `ticket`.

## API

Ops under `/api/ops/projects/{projectId}/tickets` plus fleet `GET /api/ops/tickets`, queue `GET/PATCH /api/ops/tickets/queue`, `POST /api/ops/tickets/claim-next`. Dashboard cookie APIs under `/api/projects/{id}/tickets` and `/api/settings/ticket-queue`. Catalog + MCP registry stay in sync.

## UI

Project mode **Tickets**: Todo / In progress / Done. Blocked badge on unmet deps. Create, detail, followup, release. Global settings tab: reorderable open-ticket queue.

## Scheduler

Drain on create/complete/release/followup, ticket-session terminal, and process start. Skip blocked and ops-claimed. Orphan internal claims (no live session) are released.
