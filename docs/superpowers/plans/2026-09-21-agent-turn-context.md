# Agent turn context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send compact + latest turn + the new message on follow-up turns, and store a post-turn compacted-learnings rewrite from the agent.

**Architecture:** Pure prompt assembly in `src/lib/agent-context.ts`. `runAgentTurn` composes that prompt, always prepends Ops instructions, and after a turn with assistant or tool output runs one compaction turn that writes `agent_sessions.context_compact`. Compaction events are system markers so they do not become the next “latest turn” and do not complete the user turn.

**Tech Stack:** TypeScript, Vitest, Drizzle/SQLite, Next.js Agents window.

## Global Constraints

- Tool results in the prompt are capped at 8 000 characters. User and assistant text in the latest-turn window are not truncated.
- Stored compact is capped at 16 000 characters.
- Compaction does not schedule another compaction.
- Ops instructions are prepended on every container start.
- No inline imports. Exhaustive switches get a `never` default.
- Forge deploy is Ops API only. Do not run Forge `./deploy.sh`.

---

### Task 1: Prompt assembly

**Files:** `src/lib/agent-context.ts`, `src/lib/agent-context.test.ts`

- [ ] Write failing tests for follow-up composition, failed-compaction history, compaction prompt, and the 16 000 cap.
- [ ] Implement `composeUserTurnPrompt`, `buildContextCompactionPrompt`, `eventsOutsideContextCompaction`, `shouldRequestCompaction`, and `clampContextCompact`.

### Task 2: Persist and wire turns

**Files:** `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `src/lib/agent-runner.ts`, `src/lib/agent-turn.ts`, `src/lib/agent-session-lifecycle.ts`, `src/lib/agent-restart-transcript.ts`

- [ ] Add `context_compact`.
- [ ] `runAgentTurn` sends the composed prompt and the raw user text as the user event.
- [ ] After the container exits, run one compaction turn when the latest work has assistant or tool output. Save a non-empty reply. Log failures and keep the previous compact.
- [ ] `isAgentTurnComplete` ignores events inside compaction markers.
- [ ] A follow-up sent while the turn is in flight waits and runs after compaction.
- [ ] Restart prompt includes `contextCompact`.

### Task 3: Agents window

**Files:** `src/lib/agent-stream.ts`, `src/lib/agent-turn.ts`, `src/components/agent-workspace-types.ts`, `src/components/AgentWorkspace.tsx`, `src/components/useAgentWorkspace.ts`

- [ ] Hide the compaction exchange. Show “Learnings updated.”
- [ ] Banner “Compacting learnings…” while the compaction turn runs. Follow-up stays disabled because the turn is in flight.
- [ ] Learnings disclosure renders `contextCompact`.

### Task 4: Verify

- [ ] `npx vitest run` on the touched tests, then `FORGE_LIVE_SMOKE=0 FORGE_UI_E2E=0 ./test.sh`.
