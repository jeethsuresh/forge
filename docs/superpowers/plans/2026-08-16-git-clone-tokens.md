# Git Clone Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-repo `fgc.*` clone tokens, shown in Settings/Add-project, authorizing only Forge smart HTTP for that slug.

**Architecture:** Store plaintext `clone_token` on `git_repositories`; mint on create and lazy-ensure on read; authorize in `authorizeGitHttpAccess` after Ops checks; reject `fgc.*` in Ops auth; UI shows real token and embeds it in HTTPS recipes.

**Tech Stack:** TypeScript, Drizzle/SQLite, Vitest, existing git-repo / git-http helpers.

## Global Constraints

- Token format `fgc.<shortId>.<secret>`; git-only; Ops must reject `fgc.*`.
- Dashboard session only for exposing/regenerating tokens.
- Do not commit unless asked; skip plan commit steps.
- Run `./test.sh` (or `FORGE_LIVE_SMOKE=0 FORGE_UI_E2E=0 ./test.sh`) before finishing; never Forge `./deploy.sh`.

## File map

- Create: `src/lib/git-clone-token.ts`, `src/lib/git-clone-token.test.ts`
- Create: `src/app/api/projects/[id]/git-clone-token/regenerate/route.ts`
- Modify: `src/lib/db/schema.ts`, `src/lib/db/index.ts`
- Modify: `src/lib/git-repo.ts`, `src/lib/git-http.ts`, `src/lib/ops-api-auth.ts`
- Modify: `src/lib/git-https-auth.ts`, `src/lib/git-local-push-recipes.ts`
- Modify: `src/components/GitHttpsCredentials.tsx`, `GitLocalPushRecipes.tsx`, `ProjectStudio.tsx`
- Modify: project API routes, `docs/git-server.md`, `AGENTS.md`

---

### Task 1: Mint helpers + schema

**Files:** `src/lib/git-clone-token.ts`, tests, schema, db migrate, `git-repo.ts`

- [ ] Failing tests: `mintGitCloneToken` format; create repo populates `cloneToken`
- [ ] Implement mint + `ensureGitCloneToken(repoId)`; column + `addColumnIfMissing`
- [ ] Insert token in `createForgeGitRepository` / `importGithubToForge`

### Task 2: Git HTTP + Ops isolation

- [ ] Tests: Basic/Bearer with repo token ok; other repo token denied; Ops auth rejects `fgc.*`
- [ ] Wire `authorizeGitHttpAccess`; harden `authenticateOpsRequest`

### Task 3: API expose + regenerate

- [ ] Project GET returns `gitCloneUsername` + `gitCloneToken` (lazy ensure)
- [ ] `POST .../git-clone-token/regenerate`
- [ ] Unit/integration via regenerate helper tests

### Task 4: UI + recipes + docs

- [ ] Recipes accept optional token and rewrite HTTPS URL with `git:token@`
- [ ] `GitHttpsCredentials` shows real token + optional Regenerate
- [ ] Settings + Add local/create success wired
- [ ] Docs update

### Task 5: Verify

- [ ] `FORGE_LIVE_SMOKE=0 FORGE_UI_E2E=0 ./test.sh` green; lint changed files
