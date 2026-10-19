# Pluggable agent backends

**Date:** 2026-10-19  
**Status:** Approved for implementation  
**Related:** agent containers, session lifecycle, Global settings, Forgefile `agent.packages`

## Goal

Forge can run **Cursor**, **Codex**, or a **Forge-owned local** OpenAI-compatible agent on the same branch-scoped session model. The operator picks a backend when starting a session. Every backend pins extra-high / `xhigh` thinking, falling back to high (or none for local models with no reasoning parameter). Forge deploys if **at least one** backend is usable.

## Non-goals

- User-defined command recipes or third-party adapter packages.
- A new work-item / GitHub PR “request” entity. Requests are existing session prompts and turns.
- Switching backend mid-session.
- Nested Docker for subagents.
- Binding host `~/.config/cursor` or `~/.codex` into agent containers (CLI chmod / EROFS).

## Decisions

- In-tree adapters under `src/lib/agent-backends/`. Do not reuse `src/lib/forge-agent/` (Ops MCP discovery).
- One sandbox image (`forge-agent:latest`). Adapters supply argv, env, and binds.
- Cursor and Codex CLIs stay host bind-mounts. Local is a runtime inside the agent image.
- Per-session picker. Follow-up turns keep the session backend. Restart is a new row and may pick again.
- Bootstrap / deploy-recovery / rebase-recovery pick the first available backend, preferring Cursor, then Codex, then Local.
- Thinking is not a UI toggle. Prefer extra-high / `xhigh`, then high. Local APIs that 400 on `reasoning` run without it and record `thinking=none`.
- `./deploy.sh` requires any one usable backend, not Cursor specifically. Compose binds use stub directories when a CLI is missing so empty env never creates an anonymous volume.

## Architecture

Shared: branch workspace, git clone/auth, heartbeat, prompt file bind, restart/archive, `agent_events` UI.

Per backend: binary, auth, thinking flags, stream translation, resume token.

```
UI/Ops → createAgentSession({ backend }) → registry → runAgentTurnContainer
  → docker run forge-agent (env/argv/binds from adapter)
  → stdout JSONL → Ops /events → ingestAgentEvents
```

## Adapter interface

Each backend implements:

- `id`: `cursor` | `codex` | `local`
- `displayName`
- `isAvailable()`
- `resolveThinking(model)` → `{ level, modelId?, extraArgs }`
- `containerSpec(turn)` → env, binds, `FORGE_AGENT_BIN`, argv JSON
- `parseVendorLine(line)` → ingest payload plus optional vendor session id

The container entrypoint clones, heartbeats, and execs `$FORGE_AGENT_BIN` with `FORGE_AGENT_ARGS_JSON` plus the prompt (or “read prompt file” instruction). Resume flags live in adapter argv, not hardcoded `--resume`.

## Cursor

- Bind host Cursor dir at `/opt/cursor-agent` when a real binary exists.
- Auth: `CURSOR_API_KEY` / `FORGE_CURSOR_API_KEY`.
- Invoke: `agent -p --force --output-format stream-json --stream-partial-output --model <thinking-variant> [--resume <id>]`.
- Base model from Global settings (default `gpt-5.5`). GPT-family candidates: `<base>-extra-high` then `<base>-high`. Claude-family: `<base>-thinking-high`. Never launch Auto without an explicit high/xhigh variant.
- Stream JSON unchanged. Persist vendor `session_id` on `backendSessionId` and keep `cursorSessionId` in sync.

## Codex

- Bind host Codex dir (`codex` on PATH or `FORGE_CODEX_DIR`) at `/opt/codex` when present.
- Auth: `OPENAI_API_KEY` / stored global secret. No `:ro` config bind.
- `codex exec` with `-c model_reasoning_effort="xhigh"` (retry `"high"` if rejected).
- Translate JSONL into Forge stream / thinking / tool_call lines so `agent-stream.ts` stays the only UI parser.

## Local

Forge-owned loop in the agent image against an OpenAI-compatible base URL (Ollama, llama.cpp, LM Studio).

Tools: files (read/write/edit), shell (no docker.sock; secret denylist), git, Forge Ops HTTP, Playwright browser, MCP client to Forge Ops MCP, in-process subagents (turn/tool cap, same workspace).

`reasoning.effort`: `xhigh` then `high`; on 400 omit and set `thinking=none`.

## Session model

`agent_sessions` adds:

- `backend` (default `cursor`)
- `backendSessionId` / `resumeBackendSessionId`
- `thinkingLevel` (`xhigh` | `high` | `none`)

`markTurnSucceeded` copies `backendSessionId` → `resumeBackendSessionId` (and Cursor columns when backend is cursor). Container HOME stays ephemeral.

Dashboard and Ops create accept `backend`. Reject unavailable backends with the missing CLI/key/URL named.

## Settings

Global settings tab **Agent backends**:

- Cursor: model id, CLI detected
- Codex: model id, CLI detected, API key (secrets table, global)
- Local: base URL, model, optional API key, reasoning probe

`GET` agent-sessions includes `availableBackends` for the picker.

## Errors

- Start fails closed if the chosen backend is unavailable.
- Thinking fallback is logged once per turn.
- Vendor parse failures become `system/error` events.
- Container restart policy stays backend-agnostic.

## Testing

Unit tests for thinking fallback, availability, argv, ingest resume ids, create-session rejection, container binds (no Cursor bind when unused). `./test.sh` before finish. Redeploy Forge via Ops/UI, never host `./deploy.sh` against a live Forge.
