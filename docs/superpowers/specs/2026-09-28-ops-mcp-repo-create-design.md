# Ops/MCP repository creation (design)

Date: 2026-09-28  
Status: approved for implementation  
Related: `2026-09-27-authenticated-mcp-users-design.md`, `2026-09-27-forge-agent-control-api-design.md`

## Problem

MCP clients with `fmu.*` (or the global Ops token) already have full Ops, including git HTTP. They still cannot create a Forge-hosted repository: `dashboard.projects.create` is cookie-only, and the Ops catalog has no create mutator. Project-scoped `fos.*` session tokens must not gain fleet-wide create.

## Goals

1. Authenticated MCP (`tools/call` / HTTP explorer) can create a seeded Forge git repo + project, or one-shot import GitHub, via the same registry as every other Ops tool.
2. Existing `/api/ops/*` remain the real mutators. MCP dispatches into that route.
3. Audit the create. Do not return human clone tokens (`fgc.*`).
4. Leave dashboard create, host-folder import, image mode, and auto-bootstrap agent unchanged.

## Non-goals

- Image/registry create (`mode=image`) and host-path copy (dashboard only).
- Auto-starting a bootstrap agent after Ops create (caller uses `ops.project.agent_sessions.create`).
- Letting `fos.*` session tokens create repos.
- Ops-callable minting of functional users.
- Returning `gitCloneToken` in the Ops payload.

## Auth

`POST /api/ops/projects` requires Ops auth and **unrestricted** privilege (`global` or `functional`). Session tokens receive **403** even when Forgefile bootstrap is not restricting them.

## Contract

`POST /api/ops/projects`

Body:

| Field | Notes |
|---|---|
| `actionDescription` | required, 10–2000 chars |
| `mode` | `create` (default when `name` set), `import` (default when `githubRepo` set), or `local` (seeded alias of `create`, matching dashboard) |
| `name` | required for create/local |
| `slug` | optional git slug |
| `branch` | optional default branch (default `main`) |
| `githubRepo` | required for import (`owner/repo`) |

`mode=image` → **400** pointing at the dashboard.

Success **201**:

```ts
{
  ok: true,
  opsActionId: string,
  projectId: string,
  repositoryId: string,
  name: string,
  gitSlug: string,
  branch: string,
  httpsCloneUrl: string,
  sshCloneUrl: string,
  gitEmpty: boolean,
  importedFrom: string | null,
  mode: "create" | "import",
}
```

Errors: 401 missing/bad token; 403 session token; 400 validation; 409 slug/name conflict.

MCP tool: `ops.projects.create` → `POST /api/ops/projects`. `dashboard.projects.create` stays `callable: false`.

## Implementation notes

Reuse `createForgeGitRepository` / `importGithubToForge`. Do not accept `sourceUrl` from HTTP (tests may pass it only into the shared helper). Clone with the caller’s Ops/`fmu.*` token, not a clone token.
