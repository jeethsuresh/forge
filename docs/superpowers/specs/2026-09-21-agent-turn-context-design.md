# Agent turn context and compacted learnings

**Date:** 2026-09-21  
**Status:** Approved for implementation  
**Related:** agent sessions, Agents window, Cursor agent containers

## Goal

A follow-up turn on a running agent receives the session’s stored compacted learnings, the full latest turn, and the new user message. After every turn that produced assistant or tool output, Forge asks that agent to rewrite its compacted learnings and stores the reply on the session.

## Problem

Each agent turn runs in a new container. `HOME` is `/home/agent` and is not kept. The follow-up prompt is only the new sentence, plus `FORGE_CURSOR_SESSION_ID` when one was captured. `--resume` cannot see the previous Cursor chat, so the next turn starts without the conversation.

## Non-goals

- Do not use Cursor `--resume` as the source of memory.
- Do not share a compact across sessions or branches.
- Do not drop Ops API instructions. Every container start still prepends them, because each turn is a new process.
- Do not show the compaction prompt as a user message.

## Decisions

| Topic | Choice |
|---|---|
| Next turn | Stored compact + full latest turn + the new message. Older turns stay only in the compact. |
| Compaction failure | Keep the previous compact. The next turn includes that compact plus every turn since the last successful compact. |
| No compact yet | The follow-up includes the full transcript so far plus the new message. |
| Storage | `agent_sessions.context_compact`, replaced on each successful compaction. Cap **16 000** characters. |
| Audit | System events `subtype: "context-compact"` with `phase: "request"` and `phase: "stored"`. |
| Compaction reply | The assistant text from that turn. Empty reply does not replace the stored compact. |
| Latest turn | User and assistant text in full. Each tool call is a one-line name plus a result capped at **8 000** characters. |
| Compaction does not chain | The compaction turn does not schedule another compaction. |
| No output | A turn with no assistant or tool output does not start compaction. |
| UI | Transcript hides the compaction exchange and shows “Learnings updated.” A Learnings disclosure shows `contextCompact`. While compaction runs, the banner says “Compacting learnings…” and follow-up stays disabled. A message sent in that window runs after the compact is stored. |
| Restart | Packed restart prompt includes the stored compact at the top. The new session does not copy the column; the packed prompt is its first message. |
| Remove agent | Archives the session and its compact. A new agent on the branch starts without it. |

## Prompt shape

Follow-up when a compact exists and it already covers older turns:

```text
## Compacted learnings
…

## Latest turn
### User
…
### Assistant
…
- tool shell: …

## New message
…
```

Compaction prompt asks for a standalone rewrite: decisions, files and behavior that changed, constraints, errors and fixes, and unfinished work. Previous learnings that are still true stay. Superseded guesses come out. The reply is only that markdown.

## Failure

Container errors during compaction are logged. The previous `context_compact` stays. The following user turn sends the compact plus every real turn after the last `phase: "stored"` marker.

## Tests

- Follow-up with a compact includes the compact, the latest turn, and the new message, and omits an older turn.
- With no compact, the follow-up includes every prior turn.
- After a failed compaction (no new stored compact, two turns since the last stored marker), the follow-up includes both uncompacted turns.
- A compaction reply is clamped at 16 000 characters. An empty reply does not count as a new compact.
- Compaction markers are excluded from “turn complete” so a compaction `result` event does not by itself finish the user turn.
- The Agents transcript renders “Learnings updated.” and does not render the compaction prompt as a user bubble.
- Restart prompt includes the stored compact.
