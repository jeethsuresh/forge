# Fresh agent restart and dismiss (keep the branch)

**Date:** 2026-09-21  
**Status:** Approved for implementation  
**Related:** archived sessions, recreate, agent containers, Agents workspace

## Goal

When an agent is stuck or unwanted, the operator can **Restart** it immediately: archive the current session, start a **new** agent on the **same branch** with the prior transcript (including an incomplete last turn), and leave workspace files untouched. They can **Remove agent** without deleting the git branch. The Agents sidebar lists only branches that currently have an agent; a dropdown lists branches that do not.

## Non-goals

- Do not delete git branches, Forge remotes, or `forge-branch` checkouts from this UI.
- Do not resume the Cursor CLI session id (a stuck CLI stays stuck).
- Do not auto-detect “stuck” and restart without a click.
- Do not change auto-restart-on-crash (exit code policy, cap 3).
- Do not revert uncommitted files on Restart or Remove agent.

## Decisions

| Topic | Choice |
|---|---|
| Restart | Archive current session (stop container), create a **new** session row, pack transcript into the new initial prompt. Same branch. Keep files. |
| Cursor resume | None. New session must not set `cursorSessionId` / `resumeCursorSessionId`. |
| Remove agent | `archiveAgentSession` with `revertChanges: false`. Stop runtime, close container, session goes to Archived. Branch stays. |
| Sidebar | Only branches with a live (non-archived) agent. |
| Idle branches | Dropdown at the top of the Agents sidebar: local branches with `hasAgent === false`. Selecting one opens the start-agent form on that branch. |
| Confirm | Confirm Restart and Remove agent. Do not ask about `git reset`. |
| Watch/deploy branch | Allowed in the idle dropdown if it has no agent. Still cannot be deleted via this UI (no branch delete here). |

## Restart

`restartAgentSession(sessionId)`:

1. Reject missing or already-archived sessions.
2. Build a continuation prompt from `initialPrompt` plus `agent_events` (user, assistant, system; tool calls as one-line summaries). Include the latest turn even if there is no `result` yet.
3. Cap the packed prompt at **24 000** characters by keeping the header and the **tail**.
4. Call existing `recreateAgentSession(projectId, branch, packedPrompt)` (archives live session without revert, then `createAgentSession`).
5. Return `{ sessionId, archivedSessionId, queued }`.

Prompt header (fixed meaning):

- You are replacing a previous agent on this branch that was stuck or needed a fresh start.
- Workspace files are unchanged; do not redo completed edits unless they are wrong.
- The latest turn may be incomplete; continue that work.

Dashboard: `POST /api/projects/{id}/agent-sessions/{sessionId}/restart`  
Ops: `POST /api/ops/projects/{id}/agent-sessions/{sessionId}/restart` with `actionDescription`.

UI: **Restart** next to **Stop** whenever the open session is not archived. Confirm copy states: current session is archived, files stay, new agent gets the transcript.

## Remove agent (not delete branch)

Reuse `POST …/archive` with `{ revertChanges: false }`.

UI label: **Remove agent**. On each Agents sidebar row (stop click bubbling) and keep Archive in the Session menu for the same behavior, but **Remove agent must not prompt to revert files**.

After remove: branch leaves the agent list and appears in the idle-branch dropdown. Operator can start a new agent on it.

## Agents sidebar

- Header stays: Agents, **+ New** (create branch + agent, unchanged).
- **Start on branch** `<select>`: placeholder “Branches without an agent…”, options = idle local branches. Change → select that branch, close new-branch form, show start-agent form.
- List: `branches.filter((b) => b.hasAgent)` only.
- Each row: existing status/prompt plus **Restart** (if session id) and **Remove agent**.
- Archived sessions section unchanged.

`getBranchAgentOverview` already returns all local branches with `hasAgent`. Filter in the UI; do not drop idle branches from the API (the dropdown needs them).

## Errors

- Restart of archived session: 409.
- Restart/remove of unknown session: 404.
- Recreate/create failures surface as today (400/409).

## Testing

- Transcript pack: user + assistant + incomplete last turn; truncation keeps tail; tools do not blow the budget.
- `restartAgentSession` archives old row, new row has packed prompt, no Cursor resume ids, same branch, files not reverted.
- Remove/archive without revert leaves branch in overview with `hasAgent: false`.
- Ops catalog includes `/restart`.
- UI helper: idle vs agent branches; Restart visible for live sessions.

## Out of scope

Changes-tab local branch delete, git-tree merge/delete, Overview live-branch strip actions (Open agent stays).
