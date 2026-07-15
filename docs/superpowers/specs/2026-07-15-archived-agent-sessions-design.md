# Archived agent sessions + recreate

## Goals
- Soft-archive agent sessions (`archived_at`) so branch history survives after branch delete or explicit recreate.
- Agents left rail: collapsible **Archived sessions** (default collapsed).
- Recreate agent: ask for new prompt → archive current → fresh session on same branch.
- Archived sessions open read-only (no continue / reactivate).

## Data
- `agent_sessions.archived_at` nullable integer timestamp.
- Replace unique `(project_id, branch)` with partial unique where `archived_at IS NULL`.

## Ops
- `archiveAgentSession(id)`: end if active/queued, then set `archived_at` + `completed_at`.
- Local branch DELETE archives the live session for that branch (ends first if needed when the active agent is on that branch).
- `recreateAgentSession(projectId, branch, prompt)`: archive live session if any, then `createAgentSession`.

## API / UI
- GET agent-sessions includes `archivedSessions`.
- `POST …/agent-sessions/recreate` `{ branch, prompt }`.
- AgentWorkspace archived section + Recreate control + read-only archived view.
