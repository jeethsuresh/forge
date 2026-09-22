# Compacted learnings header and ask dialog

**Date:** 2026-09-22  
**Status:** Approved for implementation  
**Related:** `2026-09-21-agent-turn-context-design.md`, Agents window, agent turn compaction

## Goal

Compacted learnings live only in a collapsible, editable disclosure under the sticky agent session bar (branch / Stop / Finish). The chat transcript never shows learnings. When the agent ends a turn by asking a question, Forge shows a Cursor-style bottom ask dialog, keeps learnings fully expanded, and skips compaction until the agent is done working (a non-question turn exit).

## Problem

Learnings currently render beside the system prompt in the transcript. There is no way to edit `context_compact` from the UI. After every user turn, `runAgentTurn` always runs compaction — including when the agent only asked a clarifying question — so the UX feels busy and mid-question context gets rewritten before the human answers.

## Non-goals

- Do not add a Cursor `AskQuestion` / structured tool protocol in this change.
- Do not move Ops / system prompt content into the Learnings disclosure.
- Do not compact only on Finish & deploy (compaction still runs after non-question turns).
- Do not show the compaction rewrite exchange in chat (existing “Learnings updated.” behavior stays).

## Decisions

| Topic | Choice |
|---|---|
| Placement | Collapsible “Learnings” under the sticky session chrome. Chat never renders learnings. |
| Default open | Collapsed when idle / after a non-question turn. **Forced open** while the session is awaiting an answer to an agent question. |
| Edit | When expanded, the body is a textarea. On blur (or explicit Save), PATCH the session `context_compact` (clamped to 16 000 chars). Edits are what the next turn receives. |
| Question detection | Heuristic on the last assistant text outside compaction markers: last non-empty line ends with `?`, or the recent text has at least two `A)`–`D)`-style options. |
| Skip compaction | After a user turn container exits, if the turn ended with a question, do **not** call `compactAgentLearnings`. Log that compaction was skipped. |
| Done working | A turn exit that does **not** look like a question still runs compaction when `shouldRequestCompaction` is true (same as today). |
| Ask dialog | When awaiting an answer (`!hasActiveRuntime`, not compacting, last assistant looks like a question), replace the generic follow-up strip with a bottom dialog that quotes the question and accepts an answer. Submitting sends a normal follow-up user message. |
| False positives | A non-question that matches the heuristic only delays compaction until the next non-question exit. Prefer false positives over compacting while the human is still answering. |

## UI

### Session bar Learnings

Under the existing sticky header (branch name, Stop, Finish, Chat/Logs), render:

```text
▸ Learnings
```

Expanded:

```text
▾ Learnings
[editable markdown textarea]
```

While awaiting an answer, the disclosure is open and cannot be collapsed until the user sends an answer or the agent starts another turn / the session ends.

### Chat

`AgentMessageList` no longer receives or renders learnings. System Ops bubbles stay as today.

### Ask dialog

Bottom of the chat pane (same slot as follow-up):

- Label: “Agent is asking”
- Quoted question (last assistant text, scrollable if long)
- Answer input + Send (same `sendMessage` path as follow-up)

While the agent is working or learnings are compacting, the dialog is not shown (banner / disabled follow-up unchanged).

## API

`PATCH /api/projects/{projectId}/agent-sessions/{sessionId}`

Body: `{ "contextCompact": string }`

- Auth: logged-in human session (same as other project agent routes).
- Validates the agent session belongs to the project.
- Clamps with `clampContextCompact` and writes `agent_sessions.context_compact`.
- Returns the updated client session payload (or `{ session }`).

No Ops agent token required for this human UI edit.

## Turn / compaction flow

```text
user turn container exits
  → if purpose was compact: store reply (unchanged)
  → else if turnEndedWithQuestion(events): skip compact; leave context_compact as-is
  → else: compactAgentLearnings as today
```

Helpers live in `agent-context.ts` (pure, unit-tested): `looksLikeAgentQuestion`, `lastAssistantText`, `turnEndedWithQuestion`.

## Tests

- Heuristic: `?` ending → true; plain status sentence → false; A)/B) choice block → true.
- `runAgentTurn` (or the compaction gate) skips compaction when the last assistant is a question and still runs it otherwise.
- PATCH clamps and persists `context_compact`.
- Agents UI: learnings are not rendered inside `AgentMessageList`; ask-dialog visibility follows the heuristic when the runtime is idle.

## Supersedes (partial)

The UI bullet in `2026-09-21-agent-turn-context-design.md` that places a Learnings disclosure beside the system prompt in the transcript is superseded by this header placement. Prompt assembly and storage rules from that doc remain in force.
