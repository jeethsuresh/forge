# Agent restart, Forge branch checkouts, and parallel agents

**Date:** 2026-09-21  
**Status:** Approved for implementation  
**Related:** per-branch Changes editor, agent containers, deploy façade, Overview tab

## Goal

Agents recover from recoverable container exits without the operator clicking Retry. Creating a branch always leaves a Forge-git checkout in a `forge-branch` container. Multiple agents run at once as long as they are on different branches. Deploy never waits on agents. Overview shows which branches are live.

## Decisions

| Topic | Choice |
|---|---|
| Restart | Record the exit, keep the session `running`, start a new container. Resume Cursor session id when we have one. |
| Unrecoverable | User stop; heartbeat / idle / wall kills; OOM **137**. Do not auto-restart. |
| Retry cap | **3** auto-restarts per turn. Then fail the turn with the last exit code. Counter resets on a successful exit 0. |
| Same branch | Still one live agent. A new prompt attaches to that session. |
| Other branches | Start immediately. Drop the project-wide queue across branches. |
| Branch create | Create in the sticky workspace from Forge git, push the new ref, start the container. Never require the branch to already exist on origin. |
| Deploy | Never 409 because an agent is running, including on `main`. Auto-watcher deploys also proceed. |
| Merge/delete of a live branch | End that agent, log why, destroy **only that** checkout/container. Other branches untouched. |
| Merge of a quiet branch | Destroy only that branch’s workspace (stop destroying every workspace on the project). |

## Agent exit restart

On `waitForAgentContainerExit` inside `runAgentTurnContainer`:

1. Log a session line and a stream `system` event: exit code, attempt number, recoverable or not.
2. Unrecoverable or cap hit → current fail path (`markTurnFailed` + error `Agent container exited with code N`).
3. Recoverable → do **not** mark failed. Persist `restartCount` and `lastExitCode`. Remove the dead container, `startAgentContainer` again with the same prompt / resume id, increment `restartCount`.
4. User stop (`stoppingSessions`) and policy kills stay terminal. Keep the existing 143-while-still-running wait (replacement already live).
5. Successful exit 0 resets `restartCount` to 0.

Unrecoverable numeric code: **137** (SIGKILL/OOM). Unrecoverable kill reasons: `user_stop`, `heartbeat_miss`, `idle_timeout`, `wall_clock`. `reconcile_missing` stays ignored (existing). `branch_merged` / `branch_deleted` are unrecoverable because the workspace is going away.

User Retry of a failed turn resets `restartCount`.

## Branch create

`createAgentBranch` (UI `POST /api/projects/:id/branches`, Ops `createBranch:true`):

1. Validate name; reject the watch/deploy branch name; reject if Forge origin already has the ref (after fetch).
2. Clone Forge git at the watch branch into the sticky workspace path for the **new** branch.
3. `git checkout -b <new>` in that workspace.
4. `git push -u origin <new>`.
5. Start/reuse `forge-branch` on that bind.
6. Fetch the new ref into `clonePath` (tracking branch) so graph/lists see it — do not `git checkout` `clonePath` onto the new branch.

If push fails: destroy the half-created workspace and fail the create.

`ensureBranchWorkspace` for an **existing** branch still fetch + checkout (materialize `origin/<branch>`). Fetch **before** lookup so a just-pushed ref is found. The “not found locally or on origin” error remains only when the ref truly does not exist on Forge git (operator asked to open a branch nobody created).

## Parallel agents

Replace project-wide “pipeline busy” with **per-branch** busy:

- `isAgentSessionActive(projectId)` stays “any live agent on this project” for badges/overview.
- `isAgentSessionActiveOnBranch(projectId, branch)` is the start/queue gate.
- Track live work per session id (`activeAgentSessions`). A project is only dropped from `activeAgentProjects` when **no** session for that project is live.
- Starting branch B while A is running starts B immediately.
- Same branch: existing attach-to-live-session behavior. Do not spawn a second session.
- Cross-branch `shouldQueueAgentSession` is always false. Leftover `queued` rows drain only when **that branch** is free.

Exclusive bind stays **per branch**: pause that branch’s `forge-branch` while its `forge-agent` runs; other branches’ containers stay up.

## Deploy, merge, delete

- Remove agent 409 from `deployProject`, `checkProjectForChanges` (auto watcher), and `git-tree-branch-ops`. Keep deployment-in-progress 409 for git-tree ops.
- Deploy tab: replace “deploy is blocked by an agent” with a non-blocking notice listing live branches.
- Merge / rebase / rebase-finalize / local delete: destroy **only** the affected branch workspace(s). Source branch on merge; rebased branch on rebase; recovery + source on finalize; deleted name on delete.
- If that branch had a live agent, end it first with kill reason `branch_merged` or `branch_deleted`.
- Agents on other branches, including `main`, keep running.

## Overview (live branches)

On the project Overview tab, a “Live branches” strip (notify-only):

- Every branch with a running/paused `forge-branch` container and/or an active agent (`pending` / `running` / `deploying`).
- Show branch name, agent status if any, container status (`running` / `paused`).
- Clicking a row with an agent opens Agents on that session; otherwise opens Changes on that branch.

Project GET includes `liveBranches: [{ name, sessionId, sessionStatus, containerStatus }]`.

## Data / APIs

`agent_sessions`:

- `restart_count` INTEGER NOT NULL DEFAULT 0
- `last_exit_code` INTEGER

`AgentKillReason` adds `branch_merged` | `branch_deleted`.

Ops/UI session payloads expose `restartCount` and `lastExitCode`.

Branch create response may include `containerStatus`.

## Error handling

- Push failure during branch create: delete the half-created workspace; no orphan container.
- Auto-restart `startAgentContainer` failure: count as a failed attempt; retry if cap remains; else fail the turn.
- Crash loop: cap 3, then fail. User Retry resets the counter.

## Tests

- Recoverable exit 1: session stays running, container started twice, log has the exit, `restartCount === 1`.
- Exit 137 / user stop / heartbeat: no restart, turn failed.
- Fourth recoverable exit: turn failed with last code.
- Create branch: Forge remote has the ref; workspace is on that branch; no “not found on origin”.
- Two agents on different branches both `running`; second start on the same branch attaches.
- Deploy while an agent is on `main` (and another on a feature): no 409.
- Merge of branch A ends A’s agent and deletes A’s workspace; B’s agent and workspace remain.
- Overview payload lists both live branches.

## Out of scope

- Two agents on the same branch.
- Changing Cursor `--resume` semantics beyond passing the existing session id into the replacement container.
- Pre-creating workspaces for every existing branch.
- GitHub `origin` push.
