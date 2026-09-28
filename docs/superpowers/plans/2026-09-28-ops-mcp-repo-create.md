# Ops/MCP repository creation

**Goal:** Global and `fmu.*` MCP clients can create a seeded Forge git repo (or import GitHub) through Ops/`ops.projects.create`. Session `fos.*` tokens cannot.

**Spec:** `docs/superpowers/specs/2026-09-28-ops-mcp-repo-create-design.md`

## Tasks

- [x] Shared helper `createProjectViaOps` wrapping `createForgeGitRepository` / `importGithubToForge`
- [x] `POST /api/ops/projects` with unrestricted auth, audit, no clone token
- [x] Catalog + MCP tool `ops.projects.create`
- [x] Tests for helper, HTTP 401/403/201, catalog/registry
- [x] Tests for helper, HTTP 401/403/201, catalog/registry
- [x] `./test.sh` (752 passed)
- [ ] Commit, merge to main, redeploy via Ops (never `./deploy.sh`)
