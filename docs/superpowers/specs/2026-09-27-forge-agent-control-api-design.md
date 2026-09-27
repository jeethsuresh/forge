# Forge Agent Control API

**Date:** 2026-09-27  
**Status:** Approved for implementation  
**Related:** `2026-07-19-per-session-ops-tokens-design.md`, `src/lib/agent-ops-prompt.ts`, Ops catalog `GET /api/ops`

## Problem

A harness that only speaks HTTP cannot discover how to operate Forge. Today the Ops catalog is a flat authenticated list with no tool schemas, no search, and no “what to do next.” MCP clients have no JSON-RPC entry. Rebase finalize is documented in the agent prompt but lives on a cookie-only dashboard route, so cookie-less agents get 401.

## Goal

Expose a full MCP-server-style control surface so a client with **zero initial knowledge** can discover and operate Forge. One shared registry, two transports:

1. **HTTP explorer** — well-known → REST shaped like MCP (`tools`, `resources`, `prompts`, `?q=`, `next`).
2. **Literal MCP JSON-RPC** over Streamable HTTP (request/response in v1).

Existing `/api/ops/*` remain the real mutators. Explorer and MCP discover and dispatch; they do not replace those contracts.

## Non-goals (v1)

- OpenAPI dump
- stdio MCP
- Full dashboard-to-Ops rewrite (project create, compose studio, settings, branch editor stay dashboard)
- Visual mockups
- SSE notification stream (optional later)
- Separate MCP session store

## Decisions

| Topic | Choice |
|---|---|
| Transports | Both, one registry |
| v1 callable tools | Current Ops catalog 1:1, plus Ops-auth rebase/finalize |
| Dashboard mutators | Discoverable (`callable: false`, `auth: dashboard_cookie`); `tools/call` returns 401/403 + `next` |
| Git | Resource (smart HTTP how-to + URI), not an Ops-callable tool |
| Public bootstrap | `GET /.well-known/forge-agent.json` and `GET /api/ops/discover` — protocol metadata only |
| Catalog lists | Schema/name search may be unauthenticated; live reads, `tools/call`, and existing `/api/ops/*` stay Ops-auth |
| Search | Global `GET /api/ops/search?q=` **and** `?q=` on explorer collections |
| Envelope | `protocol: forge-agent/1`, `self`, `search`, `next` on explorer/MCP-adjacent JSON |
| Backward compat | Do not remove existing catalog or list payload keys |
| MCP | `POST /api/ops/mcp`, JSON-RPC 2.0, protocol versions `2025-03-26` / `2025-06-18` |
| Rebase finalize | `POST /api/ops/projects/{projectId}/git-tree/rebase/finalize` with `actionDescription` + audit |
| Cookie exemption | `/.well-known/forge-agent.json` in `isSessionExemptPath` |
| Bootstrap allowlist | GET discover/search/tools/resources/prompts (lists + named schema GET). `tools/call` stays restricted. MCP `initialize` / list / `ping` allowed; `tools/call` and live `resources/read` still bootstrap-checked against the **target** Ops path |

## Protocol

### Zero-knowledge start

1. `GET /.well-known/forge-agent.json` (no auth, no project data).
2. Follow `startHere` → `GET /api/ops/discover` (same public payload, alias).
3. Read `auth` and obtain `Authorization: Bearer $FORGE_OPS_API_TOKEN` (or `X-Forge-Ops-Token`).
4. `GET /api/ops/search?q=` or `GET /api/ops/tools` to find operations.
5. Mutate via `POST /api/ops/tools/{name}/call` **or** the `next` Ops URL **or** `POST /api/ops/mcp` `tools/call`.

Every explorer response includes `next` so the client always has a suggested next request.

### Envelope

Explorer and MCP-adjacent JSON:

```json
{
  "protocol": "forge-agent/1",
  "self": "/api/ops/tools",
  "search": "/api/ops/search?q=",
  "next": [
    { "method": "GET", "href": "/api/ops/search?q=deploy", "description": "Search tools, resources, and prompts" }
  ]
}
```

`next` items may include `auth`: `"none"` | `"ops"` | `"dashboard_cookie"`.

Existing mutator responses keep their current keys (including `opsActionId`). `GET /api/ops` keeps `version`, `baseUrl`, `auth`, `rules`, `endpoints`. List GETs keep `projects` / `actions`. Sibling `protocol` / `search` / `next` may be added.

### Search

- `GET /api/ops/search?q=`
- `?q=` on `/api/ops/tools`, `/api/ops/resources`, `/api/ops/prompts`, and optionally `GET /api/ops` (filters `endpoints`)
- Rank: exact name, name prefix, name substring, tags, path, description (case-insensitive)
- Hits are schemas/names/URIs only — no live project rows in public search

### Auth tiers

| Surface | Auth |
|---|---|
| `/.well-known/forge-agent.json`, `GET /api/ops/discover` | None |
| Explorer list/schema GET (`/tools`, `/resources`, `/prompts`, `/search`) | None (metadata only) |
| MCP `initialize`, `ping`, `notifications/*`, `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list` | None |
| MCP `tools/call`, `resources/read`, `prompts/get` | Ops bearer (`prompts/get` is template text; still require Ops so session scope is consistent) |
| `POST /api/ops/tools/{name}/call` | Ops bearer |
| Existing `/api/ops/*` mutators and live GETs | Unchanged Ops bearer |
| Dashboard-kind tools/resources | Not callable with Ops token |

Session tokens remain project-scoped. Global tokens see all projects. No separate MCP session store. Optional `Mcp-Session-Id` echo only.

### Bootstrap (invalid/missing Forgefile)

Session tokens may GET catalog, discover, search, tools, resources, prompts (list + named schema), project GET, forgefile, heartbeat, events, and limited session controls. `tools/call` / MCP `tools/call` are allowed only when the **target** Ops path is already bootstrap-allowed (e.g. forgefile GET, heartbeat). Deploy/script/stop stay 403.

## HTTP explorer

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/.well-known/forge-agent.json` | public | Protocol metadata |
| GET | `/api/ops/discover` | public | Same document |
| GET | `/api/ops/search?q=` | public | Unified search |
| GET | `/api/ops/tools?q=` | public | Tool schemas |
| GET | `/api/ops/tools/{name}` | public | One tool schema |
| POST | `/api/ops/tools/{name}/call` | Ops | Validate + dispatch |
| GET | `/api/ops/resources?q=` | public | Resource list |
| GET | `/api/ops/resources/{name}` | public | One resource descriptor |
| GET | `/api/ops/prompts?q=` | public | Prompt list |
| GET | `/api/ops/prompts/{name}` | public | One prompt (argument schema; body via `prompts/get` / this GET) |
| POST | `/api/ops/mcp` | per-method | JSON-RPC |
| GET | `/api/ops/mcp` | public | v1: 405 + `next` pointing at POST (no SSE yet) |

`{name}` is the MCP-safe tool/resource/prompt name (`ops.project.deploy`).

## MCP transport

`POST /api/ops/mcp` accepts JSON-RPC 2.0 (single object; batch optional as array). Methods:

- `initialize` — return `protocolVersion` `2025-06-18` (also accept client `2025-03-26`), capabilities for tools/resources/prompts, `serverInfo` `{ name: "forge-agent", version: "1" }`
- `notifications/initialized` — no response body (HTTP 204) or empty JSON-RPC notification ack
- `ping` — `{}`
- `tools/list` — callable **and** dashboard tools (dashboard have `callable: false` in `_meta` / explorer; MCP `description` states cookie required)
- `tools/call` — validate schema; dispatch; wrap result as MCP `content` text (JSON string of the Ops payload)
- `resources/list`, `resources/templates/list`, `resources/read`
- `prompts/list`, `prompts/get`

JSON-RPC errors: `-32700` parse, `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32001` unauthorized, `-32003` dashboard/not callable.

## Tool registry (v1)

Tool names are `snake_case` segments joined with dots.

### Callable Ops tools (1:1 with catalog + finalize)

| Name | Method | Path |
|---|---|---|
| `ops.catalog.get` | GET | `/api/ops` |
| `ops.actions.list` | GET | `/api/ops/actions` |
| `ops.projects.list` | GET | `/api/ops/projects` |
| `ops.project.get` | GET | `/api/ops/projects/{projectId}` |
| `ops.project.patch` | PATCH | `/api/ops/projects/{projectId}` |
| `ops.project.forgefile.get` | GET | `/api/ops/projects/{projectId}/forgefile` |
| `ops.services.list` | GET | `/api/ops/services` |
| `ops.project.artifacts.list` | GET | `/api/ops/projects/{projectId}/artifacts` |
| `ops.project.artifact.build` | POST | `/api/ops/projects/{projectId}/artifacts/{name}/build` |
| `ops.project.artifact.download` | GET | `/api/ops/projects/{projectId}/artifacts/{name}/builds/{buildId}/download` |
| `ops.project.script.run` | POST | `/api/ops/projects/{projectId}/scripts/{name}/run` |
| `ops.project.deploy` | POST | `/api/ops/projects/{projectId}/deploy` |
| `ops.project.rollback` | POST | `/api/ops/projects/{projectId}/rollback` |
| `ops.project.stop` | POST | `/api/ops/projects/{projectId}/stop` |
| `ops.project.deployments.list` | GET | `/api/ops/projects/{projectId}/deployments` |
| `ops.project.deployment.get` | GET | `/api/ops/projects/{projectId}/deployments/{deploymentId}` |
| `ops.project.agent_sessions.list` | GET | `/api/ops/projects/{projectId}/agent-sessions` |
| `ops.project.agent_sessions.create` | POST | `/api/ops/projects/{projectId}/agent-sessions` |
| `ops.project.agent_session.get` | GET | `/api/ops/projects/{projectId}/agent-sessions/{sessionId}` |
| `ops.project.agent_session.messages` | POST | `/api/ops/projects/{projectId}/agent-sessions/{sessionId}/messages` |
| `ops.project.agent_session.stop` | POST | `/api/ops/projects/{projectId}/agent-sessions/{sessionId}/stop` |
| `ops.project.agent_session.end` | POST | `/api/ops/projects/{projectId}/agent-sessions/{sessionId}/end` |
| `ops.project.agent_session.restart` | POST | `/api/ops/projects/{projectId}/agent-sessions/{sessionId}/restart` |
| `ops.project.agent_session.heartbeat` | POST | `/api/ops/projects/{projectId}/agent-sessions/{sessionId}/heartbeat` |
| `ops.project.agent_session.events` | POST | `/api/ops/projects/{projectId}/agent-sessions/{sessionId}/events` |
| `ops.project.secret.request` | POST | `/api/ops/projects/{projectId}/secrets/{name}/request` |
| `ops.project.git.rebase_finalize` | POST | `/api/ops/projects/{projectId}/git-tree/rebase/finalize` |

Input schemas include path params plus documented body fields. Mutations require `actionDescription` (10–2000 chars) except where the underlying GET has no body.

`tools/call` expands the path, forwards the caller’s Ops auth headers, and invokes the **same exported route handlers** as `/api/ops/*`. No duplicated deploy/rollback logic.

### Dashboard tools (not Ops-callable)

Registered with `callable: false`, `auth: "dashboard_cookie"`, `kind: "dashboard"`. Searchable. `tools/call` → 401/403 and `next` explaining the human dashboard / cookie session.

Include at least: project create, project GET/PATCH (dashboard), deploy/stop/rollback (dashboard duplicates), git-tree (+ rebase, merge, push-all, resolve-conflicts), compose (+ create, merge-deploy), branch-editor (+ file, commit), settings project-routing, settings migration, git SSH keys. Cookie finalize remains listed so search still finds the old URL.

### Resources

| Name | URI template | Live read |
|---|---|---|
| `ops.catalog` | `forge://ops/catalog` | GET `/api/ops` (Ops auth) |
| `ops.projects` | `forge://ops/projects` | GET `/api/ops/projects` |
| `ops.project` | `forge://ops/projects/{projectId}` | GET project detail |
| `ops.forgefile` | `forge://ops/projects/{projectId}/forgefile` | GET forgefile |
| `ops.services` | `forge://ops/services` | GET services |
| `ops.actions` | `forge://ops/actions` | GET actions |
| `ops.deployments` | `forge://ops/projects/{projectId}/deployments` | list |
| `ops.deployment` | `forge://ops/projects/{projectId}/deployments/{deploymentId}` | detail |
| `ops.artifacts` | `forge://ops/projects/{projectId}/artifacts` | list |
| `git.smart_http` | `forge://git/{slug}` | descriptor + clone URL; not a git protocol proxy |
| `dashboard.git_tree` | `forge://dashboard/projects/{projectId}/git-tree` | 401 + `next` |
| `dashboard.compose` | `forge://dashboard/projects/{projectId}/compose` | 401 + `next` |
| `dashboard.settings` | `forge://dashboard/settings` | 401 + `next` |
| `dashboard.branch_editor` | `forge://dashboard/projects/{projectId}/branch-editor` | 401 + `next` |

### Prompts (v1)

| Name | Purpose |
|---|---|
| `forge.deploy` | Check status, then deploy with `actionDescription` |
| `forge.rollback` | Check status, then rollback |
| `forge.check_status` | Project + forgefile + services |
| `forge.rebase_recovery` | Recovery branch + Ops finalize |
| `forge.forgefile_bootstrap` | Bootstrap-limited Ops until Forgefile is valid |

Each prompt interpolates `{projectId}` / `{sessionId}` / `{branch}` arguments.

## Rebase finalize (Ops)

New route `POST /api/ops/projects/{projectId}/git-tree/rebase/finalize`:

- Ops auth, project scope, `actionDescription`, audit (`opsActionId`)
- Body: `recoveryBranch`, `sourceBranch` (required)
- Same server work as the dashboard route: `finalizeRebaseRecovery` + `endAgentAndDestroyBranchWorkspace` for both branches + `invalidateProjectBranches`
- Catalog + agent prompt use this URL (not `/api/projects/...`)
- Recovery prompt text updated to the Ops path

Dashboard cookie route remains for the UI.

## Agent prompt

`buildForgeOpsAgentInstructions` starts with well-known + discover, mentions HTTP explorer and `POST /api/ops/mcp`, and documents Ops rebase finalize with `actionDescription`. Existing curl examples stay. Tests that require `rebase/finalize` still pass; they should prefer the Ops path.

## Tests

- Registry: every current catalog Ops path has a callable tool; rebase finalize present; dashboard tools `callable: false`
- Search ranking and `?q=` filtering
- Envelope fields
- Public well-known / discover (no project ids/secrets)
- MCP initialize without auth; `tools/call` without auth → unauthorized; deploy dispatch hits `deployProject` path (handler), not a second implementation
- Session scope unchanged
- Bootstrap allowlist includes new list GETs; deploy via `tools/call` still denied
- `isSessionExemptPath("/.well-known/forge-agent.json")`
- Prompt mentions well-known/discover and Ops finalize

## Rollout

1. Land on `agent/control-with-remote-ai`
2. `./test.sh` (never Forge `./deploy.sh`)
3. Redeploy Forge via `POST /api/ops/projects/{id}/deploy`
4. Merge to default trunk

## v2 (out of this change)

Promote remaining dashboard mutators under Ops (project create, compose studio, settings, branch editor) as callable tools.
