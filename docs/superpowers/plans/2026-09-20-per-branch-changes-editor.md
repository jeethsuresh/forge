# Per-branch Changes Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Changes tab with a per-branch Monaco editor backed by sticky `forge-branch` checkouts that agents share and that merge/delete destroy.

**Architecture:** Each opened branch gets a clone under `branch-workspaces/` bind-mounted into a long-lived `forge-branch` container. Dashboard APIs read/write that host path. Agent turns pause the idle container, bind the same path, then resume. `clonePath` stays the deploy/graph mirror.

**Tech Stack:** Next.js App Router, Drizzle/SQLite, git CLI, Podman via `docker` CLI, Monaco (`@monaco-editor/react`), Vitest, Playwright.

## Global Constraints

- Files touched in this work must stay under 1000 lines (`ProjectStudio`, `AgentWorkspace`, `agent-container.ts` must not grow with editor logic).
- Never `git checkout` `project.clonePath` for Changes or agents; never bind Forge self-project live source as the editor/agent workspace.
- Branch containers: no docker.sock; image `forge-branch:latest`; `--user 0:0`.
- Agents keep using Ops/`fos.*` for git; editor commit pushes from the branch workspace to the Forge remote.
- `./build.sh --skip-install` then `./test.sh` before finish; Forge redeploy via Ops/UI, not `./deploy.sh`.
- Do not edit the Cursor plan file `.cursor/plans/per-branch_changes_editor_*.plan.md`.

## File structure

- Create: `src/lib/branch-workspace.ts` — slug, paths, ensure/destroy/pause/resume, docker run
- Create: `src/lib/branch-workspace.test.ts`
- Create: `src/lib/branch-editor.ts` — tree listing, file read with decorations, commit+push
- Create: `src/lib/branch-editor.test.ts`
- Create: `src/app/api/projects/[id]/branch-editor/route.ts`
- Create: `src/app/api/projects/[id]/branch-editor/file/route.ts`
- Create: `src/app/api/projects/[id]/branch-editor/commit/route.ts`
- Create: `src/components/ProjectBranchEditor.tsx`
- Create: `src/components/ProjectBranchFileTree.tsx`
- Create: `docker/branch/Dockerfile`
- Modify: `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `src/lib/paths.ts`
- Modify: `src/lib/agent-runner.ts`, `src/lib/agent-session-lifecycle.ts`
- Modify: git-tree merge/rebase/finalize routes, local-branches DELETE
- Modify: `src/lib/project-diff-url.ts` + tests, `ProjectStudio.tsx`, `AgentWorkspace.tsx` links
- Modify: `build.sh`, `e2e/changes.spec.ts`, `README.md`
- Delete: `src/components/ProjectDiffPanel.tsx` once unused

---

### Task 1: Schema, paths, slug, forge-branch image

**Files:**
- Modify: `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `src/lib/paths.ts`, `build.sh`
- Create: `docker/branch/Dockerfile`, `src/lib/branch-workspace.ts` (slug + path helpers first), `src/lib/branch-workspace.test.ts`

- [ ] Add `branchWorkspaces` table and INIT_SQL
- [ ] `resolveBranchWorkspacesRoot()` + `branchWorkspaceSlug()` + `branchContainerName()`
- [ ] Tests for slug uniqueness and `:memory:` root
- [ ] Alpine Dockerfile + `build.sh` docker build

---

### Task 2: Ensure / destroy / pause / resume

**Files:** `src/lib/branch-workspace.ts`, `src/lib/branch-workspace.test.ts`

- [ ] Inject docker runner (same pattern as agent-container)
- [ ] `ensureBranchWorkspace(project, branch)` clones from `projectRemoteUrl`, checkouts branch, starts container
- [ ] `destroyBranchWorkspace` / `destroyProjectBranchWorkspaces`
- [ ] `pauseBranchWorkspace` / `resumeBranchWorkspace`
- [ ] Tests with temp git remotes + mocked docker

---

### Task 3: Tree / file / commit lib

**Files:** `src/lib/branch-editor.ts`, `src/lib/branch-editor.test.ts`

- [ ] `listBranchEditorFiles(workspacePath, watchBranch)`
- [ ] `readBranchEditorFile` / `writeBranchEditorFile` (reuse `assertSafeRepoRelativePath`, `languageIdForPath`, decorations)
- [ ] `commitBranchEditorChanges` → `commitAllChanges` + `pushBranch`
- [ ] Tests against a real temp clone with a feature branch vs main

---

### Task 4: HTTP routes

**Files:** `src/app/api/projects/[id]/branch-editor/{route,file/route,commit/route}.ts`

- [ ] Session auth, project lookup, ensure workspace, JSON shapes from the spec

---

### Task 5: Agents + merge/delete

**Files:** `src/lib/agent-runner.ts`, `src/lib/agent-session-lifecycle.ts`, merge/rebase/delete routes

- [ ] Agent turn: ensure workspace, pause, bind path, resume in `finally`
- [ ] Commit/revert session uses workspace path
- [ ] Merge/rebase/delete destroy workspaces
- [ ] Update grep invariants in `agent-container-startup.integration.test.ts`

---

### Task 6: UI

**Files:** `ProjectBranchEditor.tsx`, `ProjectBranchFileTree.tsx`, `ProjectStudio.tsx`, `project-diff-url.ts`, `e2e/changes.spec.ts`, `README.md`

- [ ] Branch picker, tree, Monaco, commit+push
- [ ] Swap studio; delete `ProjectDiffPanel` if unused
- [ ] URL helpers without mode chips
- [ ] e2e: heading + combobox/select, no Uncommitted button

---

### Task 7: Gate and ship

- [ ] `./build.sh --skip-install`
- [ ] `./test.sh`
- [ ] Commit remaining work; merge feature branch to `main`
- [ ] Redeploy Forge via Ops/UI (not `./deploy.sh`)
