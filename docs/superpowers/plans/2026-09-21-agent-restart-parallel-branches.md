# Agent Restart, Forge Branch Checkouts, and Parallel Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (tasks are tightly coupled). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-restart recoverable agent exits, create branches as Forge-git workspaces, and run one agent per branch in parallel without blocking deploy.

**Architecture:** Pure exit-policy helpers decide restart vs fail. `runAgentTurnContainer` loops up to 3 recoverable restarts without marking failed. `createAgentBranch` clones watch from Forge git into the sticky path, branches, pushes, then starts `forge-branch`. Live work is tracked per session id so two branches can run at once. Merge/delete ends only that branch.

**Tech Stack:** Next.js App Router, Drizzle/SQLite, git CLI, Podman via `docker` CLI, Vitest.

## Global Constraints

- Files touched must stay under 1000 lines; extract helpers rather than growing `agent-runner.ts`.
- Never `git checkout` live Forge `clonePath` / `/data/forge-source` for agents or Changes.
- Agents push to Forge git, not GitHub `origin`.
- `./build.sh --skip-install` then `./test.sh` before finish; Forge redeploy via Ops/UI, not `./deploy.sh`.
- TDD: failing test before production code for each behavior.

## File structure

- Create: `src/lib/agent-exit-restart.ts`, `src/lib/agent-exit-restart.test.ts`
- Create: `src/lib/agent-liveness.ts` (session-level active set helpers) if `agent-state.ts` would otherwise grow past a focused change
- Modify: `src/lib/db/schema.ts`, `src/lib/db/index.ts`
- Modify: `src/lib/agent-runner.ts` (`runAgentTurnContainer`)
- Modify: `src/lib/agent-session-lifecycle.ts` (`createAgentBranch`, session start)
- Modify: `src/lib/branch-workspace.ts` (create-from-watch + fetch-before-lookup)
- Modify: `src/lib/agent-queue.ts`, `src/lib/agent-state.ts`
- Modify: `src/lib/project-deploy.ts`, `src/lib/deployer.ts`, `src/lib/git-tree-branch-ops.ts`
- Modify: git-tree merge/rebase/finalize, local-branches DELETE
- Modify: `src/app/api/projects/[id]/route.ts`, Overview + Deploy tab UI
- Modify: tests listed per task

---

### Task 1: Exit policy + schema

**Files:** `src/lib/agent-exit-restart.ts`, `src/lib/agent-exit-restart.test.ts`, `src/lib/db/schema.ts`, `src/lib/db/index.ts`

- [ ] Failing tests for `isRecoverableAgentExit({ exitCode, killReason, restartCount })` and `MAX_AGENT_EXIT_RESTARTS === 3`
- [ ] Implement helpers
- [ ] Add `restartCount` / `lastExitCode` columns + `addColumnIfMissing`
- [ ] Extend `AgentKillReason` with `branch_merged` | `branch_deleted`
- [ ] Schema insert test that the new columns default

```ts
export const MAX_AGENT_EXIT_RESTARTS = 3;

export function isUnrecoverableKillReason(reason: string | null | undefined): boolean {
  return (
    reason === "user_stop" ||
    reason === "heartbeat_miss" ||
    reason === "idle_timeout" ||
    reason === "wall_clock" ||
    reason === "branch_merged" ||
    reason === "branch_deleted"
  );
}

export function isRecoverableAgentExit(input: {
  exitCode: number;
  killReason?: string | null;
  restartCount: number;
}): boolean {
  if (input.restartCount >= MAX_AGENT_EXIT_RESTARTS) return false;
  if (isUnrecoverableKillReason(input.killReason)) return false;
  if (input.exitCode === 137) return false;
  if (input.exitCode === 0) return false;
  return true;
}
```

---

### Task 2: Auto-restart in `runAgentTurnContainer`

**Files:** `src/lib/agent-runner.ts`, `src/lib/agent-runner.test.ts` (or a focused `src/lib/agent-exit-restart.integration.test.ts` with docker runner mocked)

- [ ] Test: mocked `waitForAgentContainerExit` returning 1 then 0 → two `startAgentContainer` calls, session not failed, `restartCount` 1 then reset to 0
- [ ] Test: 137 fails immediately
- [ ] Test: four `1`s → fail after 3 restarts
- [ ] Loop: while recoverable, log, increment, remove, start again; keep 143-live-replacement behavior

Record via `appendSessionLog` + `recordEvent(sessionId, "system", JSON.stringify({ type: "system", subtype: "agent-exit", exitCode, attempt, recoverable }))`.

`reactivateFailedSession` / user Retry must set `restartCount: 0`.

---

### Task 3: Create branch as Forge workspace

**Files:** `src/lib/branch-workspace.ts`, `src/lib/branch-workspace.test.ts`, `src/lib/agent-session-lifecycle.ts`, `src/lib/git-workspace.ts`

- [ ] Test: `createBranchWorkspace(project, "agent/foo")` clones watch, pushes `agent/foo` to the bare remote, starts container; remote `git show-ref` has the branch
- [ ] Test: creating a name that already exists on origin throws “already exists”
- [ ] Test: `ensureBranchWorkspace` fetches before lookup so a just-pushed ref is found
- [ ] `createAgentBranch` calls `createBranchWorkspace` then fetches tracking ref on `clonePath` without checking it out
- [ ] `ensureLocalBranchForAgent` fetches origin before `rev-parse origin/<branch>`

---

### Task 4: Parallel agents per branch

**Files:** `src/lib/agent-state.ts`, `src/lib/agent-queue.ts`, `src/lib/agent-session-lifecycle.ts`, `src/lib/agent-runner.ts`, tests

- [ ] `activeAgentSessions: Set<string>`
- [ ] `markAgentSessionLive(sessionId, projectId)` / `markAgentSessionIdle(sessionId, projectId)` — only delete project from `activeAgentProjects` when no live sessions remain for it
- [ ] `isAgentSessionActiveOnBranch(projectId, branch)`
- [ ] `shouldQueueAgentSession` always false for a different branch (start immediately)
- [ ] Test: two running sessions on different branches; `isAgentSessionActive` true; starting B does not throw
- [ ] Test: second start on same branch still “already active” / attach
- [ ] `processAgentQueue` starts queued rows whose **branch** is free, even if another branch is live

---

### Task 5: Deploy never blocked; merge/delete scoped

**Files:** `src/lib/project-deploy.ts`, `src/lib/project-deploy.test.ts`, `src/lib/deployer.ts`, `src/lib/git-tree-branch-ops.ts`, merge/rebase/finalize/local-branches routes, `src/lib/branch-workspace.ts`

- [ ] Invert deploy test: active agent + `trigger: "manual"` does **not** 409 with agent-session message
- [ ] Remove `isAgentSessionActive` skip in `checkProjectForChanges`
- [ ] `branchOpsBlockedResponse` only checks `isDeploymentActive`
- [ ] Helper `endAgentAndDestroyBranchWorkspace(projectId, branch, reason)`
- [ ] Merge destroys `body.branch` only (and `into` only if we also recreate watch — spec: destroy the **affected** source branch; leave `into`/`main` workspace)
- [ ] Rebase destroys `branch`; finalize destroys `sourceBranch` + `recoveryBranch`

---

### Task 6: Overview live branches UI

**Files:** `src/app/api/projects/[id]/route.ts`, `src/lib/agent-runner.ts` (`getBranchAgentOverview` / new `listLiveBranches`), `src/components/project-studio-types.ts`, `src/components/ProjectStudioOverview.tsx`, `src/components/ProjectStudio.tsx`

- [ ] `liveBranches` on project GET
- [ ] Overview strip: live branches; click → Agents or Changes
- [ ] Deploy tab: non-blocking notice, not “blocked by agent”; `deployBusy` no longer tied to `blockingAgentSession`

---

### Task 7: Gate, commit, merge, redeploy

- [ ] `./build.sh --skip-install` and `./test.sh` in the worktree
- [ ] Merge `feat/agent-restart-parallel` into `main` (no force-push)
- [ ] Push `main` to Forge git remote `forge`
- [ ] Ops `POST /api/ops/projects/6b521089-fb3e-4e9c-b076-3291b1c0d4b6/deploy`
