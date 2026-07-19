# Per-session Ops API tokens (design)

Date: 2026-07-19  
Status: approved for planning

## Problem

Forge prepends Ops API instructions on an agent’s first turn. Today those instructions warn:

> `WARNING: FORGE_OPS_API_TOKEN is not configured; ops calls will fail until an operator sets it.`

That warning is accurate whenever the optional global env var `FORGE_OPS_API_TOKEN` is unset. Agents then have no way to authenticate to `/api/ops/*`, even though Forge itself started the agent and knows the session. Operators should not need to mint a shared secret for everyday agent ops.

## Goals

1. Every **valid** (non-archived) agent session always has a working Ops token in its process env.
2. Agents never see the “not configured” warning.
3. Keep an **optional** global `FORGE_OPS_API_TOKEN` for CI / host curl.
4. Session tokens are scoped to **that session’s project** (least privilege).
5. No per-session token column — tokens are **HMAC-derived** and always recomputable.

## Non-goals

- Removing Ops auth entirely.
- Scoping session tokens to individual HTTP paths beyond project ownership.
- UI for rotating the HMAC secret (env or wipe persisted file is enough for v1).

## Token model

### Server secret

- Env: `FORGE_OPS_SESSION_SECRET` (preferred when set).
- If unset: generate a cryptographically random secret on first use and persist under `/data/forge-ops-session-secret` (same durability pattern as other `/data` Forge state). Read back on subsequent boots.
- Tests / `:memory:` DB: use an in-memory / env secret; do not require `/data`.

### Token format

```text
fos.<sessionId>.<base64url(HMAC-SHA256(secret, "forge-ops-v1:" + sessionId + ":" + projectId))>
```

- Self-identifying: verifier parses `sessionId` from the token, loads the session, recomputes the MAC with the session’s `projectId`, and compares in constant time.
- Always mintable given `(sessionId, projectId)` and the server secret.

### Validity

A session token is accepted only when **all** of:

- Token MAC verifies for that session’s `projectId`.
- Session row exists.
- `archived_at` is null (archived / soft-deleted sessions are revoked).
- The request targets that session’s project (see enforcement below).

Status values (`pending`, `running`, `completed`, `failed`, `deploying`, …) do **not** revoke the token. Completed sessions between turns still need ops (deploy, end, status). Archival is the revoke signal.

**Always-available guarantee:** For any non-archived session, `mintSessionOpsToken(sessionId, projectId)` succeeds; agent spawn always sets `FORGE_OPS_API_TOKEN` to that value.

## Dual authentication

`requireOpsAuth` accepts either:

| Kind | Credential | Scope |
|------|------------|--------|
| Global | `Authorization: Bearer $FORGE_OPS_API_TOKEN` or `X-Forge-Ops-Token` matching env | Full Ops API (all projects) |
| Session | Bearer matching `fos.<sessionId>.<mac>` | Only `/api/ops/projects/{session.projectId}/…` and catalog |

Return shape for handlers (conceptually):

```ts
type OpsAuth =
  | { kind: "global" }
  | { kind: "session"; sessionId: string; projectId: string };
```

Unauthorized → `401`. Cross-project use of a session token → `403`.

### “Configured” behavior

- Ops API is considered available whenever the **session secret** can be resolved (always after bootstrap) **or** the global token is set.
- Remove the **503** “Forge Ops API is not configured (set FORGE_OPS_API_TOKEN)” when the session secret exists.
- External callers with neither global token nor a session token still get `401`.

`X-Forge-Agent-Session-Id` remains supported for audit linking. Session id is also embedded in the token; prefer deriving `agentSessionId` for audit from the verified session token when present, falling back to the header.

## Agent environment and prompt

### Spawn (`agent-runner`)

On every agent turn:

```ts
env.FORGE_OPS_API_TOKEN = mintSessionOpsToken(sessionId, project.id);
env.FORGE_OPS_API_BASE = opsApiBaseUrl();
```

Do **not** gate injection on `process.env.FORGE_OPS_API_TOKEN`. Agents always use the session token (even if a global token is set on Forge).

### Prompt (`agent-ops-prompt`)

- Delete the configured / WARNING branch.
- Always state that the token is available as `FORGE_OPS_API_TOKEN`.
- Keep curl examples using `$FORGE_OPS_API_TOKEN` and `X-Forge-Agent-Session-Id`.

### Catalog (`GET /api/ops`)

Document both global and session-token auth. Session scope rule must be explicit in the catalog/rules text.

## API surface enforcement

| Path | Global | Session |
|------|--------|---------|
| `GET /api/ops` | yes | yes |
| `GET /api/ops/actions` | yes | yes (filter or allow; implementations may return only actions for that project / session) |
| `GET /api/ops/projects` | yes | yes — return **only** the session’s project, or `403` if listing all is undesirable; prefer filtered list of one |
| `…/projects/{projectId}/…` | yes if exists | yes only when `projectId === auth.projectId` |

Mutating routes keep `actionDescription` + audit behavior unchanged.

## Files likely touched

- `src/lib/ops-api-auth.ts` — secret load/mint, verify global vs session, auth result type
- `src/lib/ops-api-route.ts` — `requireOpsAuth` uses new verifier; drop global-only 503 when secret exists; project-scope helper
- `src/lib/agent-ops-prompt.ts` — remove WARNING; catalog auth notes
- `src/lib/agent-runner.ts` — always inject session token
- Ops route handlers — pass project scope checks where list/cross-project
- `src/lib/ops-api.test.ts`, `agent-ops-prompt` / runner tests — coverage below
- `.env.example`, `AGENTS.md` — document dual auth + `FORGE_OPS_SESSION_SECRET`
- `docker-compose.yml` — optional `FORGE_OPS_SESSION_SECRET` passthrough

## Testing

1. Mint: same `(session, project, secret)` → stable token; different project → different MAC.
2. Verify: valid session token accepted; wrong MAC → 401; archived session → 401.
3. Scope: session token on own project → 200 path; other projectId → 403.
4. Global token still full access when set.
5. Agent spawn env always includes `FORGE_OPS_API_TOKEN` starting with `fos.`.
6. `buildForgeOpsAgentInstructions` never contains `WARNING: FORGE_OPS_API_TOKEN is not configured`.
7. Without global token but with session secret, Ops is not 503 for missing global config.

## Rollout

1. Land code; existing deploys without global token start working for agents after redeploy (session secret auto-persists on `/data`).
2. Optional: set `FORGE_OPS_SESSION_SECRET` in `.env` for multi-replica or secret rotation discipline.
3. Keep `FORGE_OPS_API_TOKEN` optional for CI.

## Out of scope / follow-ups

- Rotating session secret (invalidates all session tokens until agents respawn — acceptable).
- Binding session tokens to a single turn / short TTL.
- Fine-grained RBAC beyond project scope.
