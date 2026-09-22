# Fresh agent restart and dismiss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators Restart a stuck agent as a fresh session with packed transcript, and Remove agent (archive, keep branch) from the Agents view, with an idle-branch dropdown.

**Architecture:** Pack `agent_events` into a continuation prompt, then reuse `recreateAgentSession`. Remove agent is `archiveAgentSession` without revert. Sidebar filters `hasAgent`; idle branches feed a select. No Cursor resume ids.

**Tech Stack:** TypeScript, Vitest, Next.js App Router, existing AgentWorkspace / Ops catalog.

## Global Constraints

- Do not delete git branches or branch workspaces from this feature.
- Restart and Remove agent never pass `revertChanges: true`.
- New restart session must not copy `cursorSessionId` / `resumeCursorSessionId`.
- Packed prompt max **24000** characters; keep header + tail.
- Confirm Restart and Remove agent; no visual mockups.
- Forge: `./test.sh` before finish; never Forge `./deploy.sh`; push Forge git not GitHub.

---

### Task 1: Transcript packer

**Files:**
- Create: `src/lib/agent-restart-transcript.ts`
- Test: `src/lib/agent-restart-transcript.test.ts`

**Produces:** `AGENT_RESTART_PROMPT_MAX_CHARS`, `buildAgentRestartPrompt({ initialPrompt, events })`

- [ ] **Step 1: Write failing tests** for user+assistant+incomplete last turn, tool one-liners, tail truncation.
- [ ] **Step 2: Implement packer** using `eventsToDisplayMessages`; roles user/assistant/system; tools as `- tool {name}: {content slice}`.
- [ ] **Step 3: Tests pass.** Commit packer.

### Task 2: `restartAgentSession`

**Files:**
- Modify: `src/lib/agent-session-lifecycle.ts`, `src/lib/agent-runner.ts` (re-export)
- Test: `src/lib/agent-session-archive.test.ts` (extend)

**Produces:** `restartAgentSession(sessionId: string): Promise<{ sessionId: string; queued: boolean; archivedSessionId: string | null }>`

- [ ] **Step 1: Failing tests** — archives old, new prompt contains transcript, no cursor ids, 409 if archived.
- [ ] **Step 2: Implement** via `buildAgentRestartPrompt` + `recreateAgentSession`.
- [ ] **Step 3: Tests pass.** Commit.

### Task 3: HTTP + Ops

**Files:**
- Create: `src/app/api/projects/[id]/agent-sessions/[sessionId]/restart/route.ts`
- Create: `src/app/api/ops/projects/[id]/agent-sessions/[sessionId]/restart/route.ts`
- Modify: `src/lib/agent-ops-prompt.ts`, `src/lib/ops-api.test.ts`

- [ ] **Step 1: Catalog test** expects `/restart`.
- [ ] **Step 2: Dashboard + Ops routes** mirroring `/end` auth/audit.
- [ ] **Step 3: Tests pass.** Commit.

### Task 4: UI helpers + Agents workspace

**Files:**
- Modify: `src/components/agent-workspace-types.ts`
- Create: `src/components/agent-workspace-types.test.ts`
- Modify: `src/components/AgentWorkspace.tsx`, `src/components/useAgentWorkspace.ts`

**Produces:** `idleBranches`, `agentBranches`, `showRestartButton`; Restart + Remove agent + idle `<select>`.

- [ ] **Step 1: Helper tests.**
- [ ] **Step 2: Wire fetch restart; Remove agent archives with `revertChanges: false` only.**
- [ ] **Step 3: Sidebar filter + dropdown + row actions + header Restart.**
- [ ] **Step 4: `FORGE_LIVE_SMOKE=0 FORGE_UI_E2E=0 ./test.sh`.** Commit.

### Task 5: Ship

- [ ] Merge to `main`, push `forge` remote, Ops deploy Forge project. Do not `git push origin`. Do not `./deploy.sh`.
