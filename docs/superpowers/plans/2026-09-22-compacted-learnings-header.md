# Compacted learnings header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move compacted learnings into an editable header disclosure, skip compaction when the agent asks a question, and show a bottom ask dialog until the human answers.

**Architecture:** Pure helpers in `agent-context.ts` detect question-shaped last assistant text. `runAgentTurn` skips `compactAgentLearnings` on those exits. A PATCH on the session route persists human edits to `context_compact`. The Agents window renders Learnings under the sticky bar and swaps the follow-up strip for an ask dialog when awaiting an answer.

**Tech Stack:** TypeScript, Vitest, Next.js App Router, React client components.

## Global Constraints

- Stored compact capped at 16 000 characters (`clampContextCompact`).
- Compaction still runs after non-question turns with assistant/tool output.
- No Forge `./deploy.sh`; redeploy via Ops API.
- No learnings in the chat transcript.

---

### Task 1: Question detection + skip compaction

**Files:** `src/lib/agent-context.ts`, `src/lib/agent-context.test.ts`, `src/lib/agent-runner.ts`

- [ ] Add `looksLikeAgentQuestion`, `lastAssistantText`, `turnEndedWithQuestion` with unit tests.
- [ ] After a user turn in `runAgentTurn`, call compaction only when `!turnEndedWithQuestion(events)`.
- [ ] Log when compaction is skipped for a question.

### Task 2: PATCH context_compact

**Files:** `src/app/api/projects/[id]/agent-sessions/[sessionId]/route.ts` (+ test if route tests exist / thin lib helper)

- [ ] PATCH accepts `{ contextCompact: string }`, clamps, updates the row, returns session.

### Task 3: Header Learnings + ask dialog UI

**Files:** `src/components/AgentMessageList.tsx`, `src/components/AgentWorkspace.tsx`, `src/components/useAgentWorkspace.ts`, new small components as needed

- [ ] Remove chat `LearningsBlock` / `learnings` prop from `AgentMessageList`.
- [ ] Add collapsible editable Learnings under the sticky session header; force-open while awaiting a question; blur/Save PATCHes compact.
- [ ] When awaiting a question (idle runtime, not compacting, heuristic true), show bottom ask dialog; Send uses existing `sendMessage`.

### Task 4: Verify + ship

- [ ] `npx vitest run` on touched tests, then `FORGE_LIVE_SMOKE=0 FORGE_UI_E2E=0 ./test.sh` (or full `./test.sh` when Ops token allows live smoke).
- [ ] Commit, merge to main if on the feature branch, deploy Forge via Ops API.
