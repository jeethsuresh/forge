# Authenticated MCP functional users (design)

Date: 2026-09-27  
Status: approved for implementation  
Related: `2026-07-19-per-session-ops-tokens-design.md`, `2026-08-16-git-clone-tokens-design.md`, `2026-09-27-forge-agent-control-api-design.md`

## Problem

MCP `tools/call` and live resource reads already require an Ops Bearer token. External MCP clients (Claude Desktop, Cursor, ChatGPT, and similar) have no first-class credential: they must share the env `FORGE_OPS_API_TOKEN` or impersonate a running `fos.*` session. There is no named, revocable identity you can mint from the UI.

## Goals

1. Register one or more **functional users** (MCP-driven agents) from Global settings.
2. Each registration yields a secret that authenticates **full Ops on every project**, including MCP `tools/call` and raw `/api/ops/*`.
3. Audit logs name that functional user instead of a shared global token.
4. Rotate or revoke without touching `.env` or in-container session tokens.
5. Keep `fos.*` (project-scoped session) and `fgc.*` (git-only) unchanged.

## Non-goals

- Dashboard cookie login for functional users.
- Project-scoped or read-only MCP secrets.
- Letting an MCP agent register more functional users (dashboard session only).
- MCP OAuth / Dynamic Client Registration.
- Replacing the optional env `FORGE_OPS_API_TOKEN` (CI/host curl stays).
- Per-tool permission matrix.
- Expiry, IP allowlists, Ops-callable minting.

## Identity and data

New table `functional_users`, not `users`:

| Column | Notes |
|---|---|
| `id` | UUID |
| `name` | Unique, operator-chosen (`claude-desktop`, `cursor-mcp`) |
| `tokenVersion` | Integer, starts at 1; increment on rotate |
| `createdAt` | |
| `updatedAt` | |

No password. Login continues to read only `users`. Delete the row to revoke.

## Token

```text
fmu.<userId>.<base64url(HMAC-SHA256(opsSessionSecret, "forge-mcp-v1:" + userId + ":" + tokenVersion))>
```

- Distinct prefix from `fos.*` and `fgc.*`.
- Remintable: settings can always show the current secret.
- Rotate = increment `tokenVersion` and remint; old secret dies immediately.
- Verify: parse `userId`, load row, recompute MAC, constant-time compare.
- `fgc.*` still never authorizes Ops.

Uses the existing Ops session secret (`FORGE_OPS_SESSION_SECRET` or the persisted file). No new secret file.

## Auth model

```ts
type OpsAuth =
  | { kind: "global" }
  | { kind: "session"; sessionId: string; projectId: string }
  | { kind: "functional"; userId: string; name: string };
```

`authenticateOpsRequest` order:

1. Missing token → null
2. `fgc.*` → null
3. Env `FORGE_OPS_API_TOKEN` match → `global`
4. `fmu.*` valid + row exists → `functional`
5. `fos.*` valid + session not archived → `session`

Privilege: `functional` is treated like `global` everywhere that currently special-cases global:

- `denyIfWrongProject` → allow any project
- `denyIfBootstrapRestricted` → not restricted (`kind !== "session"` already)
- Git smart HTTP → same privilege as `ops-global`
- Services/projects list → all projects

MCP does not change method allowlists. `initialize` / `tools/list` stay unauthenticated; `tools/call` and live `resources/read` accept `fmu.*` because they already call `authenticateOpsRequest`.

## Audit

`recordOpsAction` today hardcodes `actor: "agent"`.

- Session token → `actor: "agent"` + `agentSessionId` (unchanged)
- Env global → `actor: "global"`
- Functional → `actor: "functional:<name>"` and `agentSessionId` null

No new audit column in v1.

## Settings UI

New Global settings tab: **MCP agents**.

- Short explanation: these are machine identities for external MCP clients; secret = full Ops.
- List: name, created, token (copy), **Regenerate**, **Revoke**.
- Register form: name → creates row, shows `fmu.…` immediately.
- Secret stays visible on later visits (same as git clone tokens).
- Regenerate confirms that existing MCP clients will fail until updated.
- Dashboard session cookie only. Not on the Ops catalog as a callable tool.

APIs (session cookie, same pattern as git SSH keys):

- `GET /api/settings/functional-users`
- `POST /api/settings/functional-users` `{ name }`
- `POST /api/settings/functional-users/:id/regenerate`
- `DELETE /api/settings/functional-users/:id`

## Docs / discovery

- Catalog / well-known / MCP `initialize` instructions: Bearer may be env token, `fos.*`, or a registered `fmu.*` secret.
- `docs/git-server.md` / `AGENTS.md`: `fmu.*` is Ops (and therefore git HTTP); it is not a clone token. Agents in containers keep using `fos.*`.
- No change to zero-knowledge public payloads (still no project data, still no secrets).

## Errors

- Unknown / bad `fmu.*` → `401`
- Revoked (row deleted) → `401`
- Old version after rotate → `401`
- Register with empty/duplicate name → `400`
- Settings APIs without dashboard login → `401`
- Functional user cannot log into `/api/auth/login`

## Tests

- Mint, remint matches, rotate invalidates old, delete invalidates.
- `authenticateOpsRequest`: `fmu.*` → `kind: "functional"`; `fgc.*` still rejected; `fos.*` unchanged.
- Functional token deploys / lists any project (same as global).
- MCP `tools/call` succeeds with `fmu.*`, fails with a rotated secret.
- Bootstrap guard does not restrict functional tokens.
- Git HTTP accepts `fmu.*` like global Ops.
- Login still rejects functional names; settings routes require a cookie.
- Audit row for a mutating Ops call names the functional user.

## Out of scope

Expiry, IP allowlists, per-project grants, dashboard UI for these identities beyond the settings tab, Ops-callable minting.
