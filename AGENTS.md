<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Agent workflow (mandatory)

- **Run `./test.sh` before finishing any task** that touches code or config. Do not end the turn with failing or unrun tests.
- If tests fail, **fix them** (or revert the breaking change) and re-run `./test.sh` until all pass.
- Use `./build.sh` → `./test.sh` → `./deploy.sh` for deploy-related work; a failing test blocks deploy.
- Self-update runs `./test.sh` inside the updater sidecar; tests use `FORGE_DB_PATH=:memory:` so they never lock `/data/forge.db`.

## Per-project routing

- Each project can set a dedicated **host port** (`projects.host_port`) and optional **Caddy route** (`projects.caddy_route_json`).
- Orchestrator passes `--project-name <compose-slug>` to every `build.sh` / `test.sh` / `deploy.sh` / `teardown.sh` invocation; when a port is configured it also passes `--host-port <port>` and sets `HOST_PORT` in the script environment.
- Edit per-project routing on the project **Config & history** tab or in **Global settings → Project routing**.
- Watched repos must implement `scripts/lib/common.sh` (or equivalent) so root scripts accept `--project-name` and `--host-port` / `--port`.
