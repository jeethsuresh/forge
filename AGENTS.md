<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Agent workflow (mandatory)

- **Run `./test.sh` before finishing any task** that touches code or config. Do not end the turn with failing or unrun tests.
- If tests fail, **fix them** (or revert the breaking change) and re-run `./test.sh` until all pass.
- Use `./build.sh` → `./test.sh` → `./deploy.sh` for deploy-related work on **managed (non-Forge) projects**; a failing test blocks deploy.
- **NEVER run Forge's own `./deploy.sh`.** For the Forge/Orchestrator project, always redeploy via the Ops API (`POST /api/ops/projects/{id}/deploy`) or the UI “Redeploy” / “Update Forge” action. Running `deploy.sh` against Forge leaves the container in a state the self-updater cannot recreate properly.
- Self-update runs `./test.sh` inside the updater sidecar; tests use `FORGE_DB_PATH=:memory:` so they never lock `/data/forge.db`.

## Per-project routing

- Each project can set a dedicated **host port** (`projects.host_port`) and optional **Caddy route** (`projects.caddy_route_json`).
- Orchestrator passes `--project-name <compose-slug>` to every `build.sh` / `test.sh` / `deploy.sh` / `teardown.sh` invocation; when a port is configured it also passes `--host-port <port>` and sets `HOST_PORT` in the script environment.
- Edit per-project routing on the project **Config & history** tab or in **Global settings → Project routing**.
- Watched repos must implement `scripts/lib/common.sh` (or equivalent) so root scripts accept `--project-name` and `--host-port` / `--port`.

## Forge Ops API (for agents)

Forge exposes a machine-readable **Ops API** at `/api/ops/*` for deploy, rollback, monitoring, agent control, and config changes.

- **Auth:** `Authorization: Bearer $FORGE_OPS_API_TOKEN` (set in `.env` / container env).
- **Audit:** Every POST/PATCH must include `actionDescription` (10–2000 chars) stating exactly what the agent is doing and why.
- **Session link:** Pass `X-Forge-Agent-Session-Id: <session-id>` to attach ops calls to the agent session audit log.
- **Catalog:** `GET /api/ops` returns all endpoints and curl examples.
- **Agent prompt:** Forge prepends ops instructions to the first turn of each agent session automatically.

When implementing or debugging ops flows, run `./test.sh` and consult `src/lib/agent-ops-prompt.ts` for the canonical instruction text.
