<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Forgefile (required)

- Every project (including Forge itself) must have a valid root **`Forgefile`**. See `docs/Forgefile.md` and `docs/forgefile.template.yml`.
- Deploy and named script runs fail closed when the Forgefile is missing or invalid. Prefer Ops/UI script run and deploy endpoints over inventing ad-hoc script invocations.
- Agents may be asked to author a Forgefile via the bootstrap CTA; do not deploy until validation passes.

## Git server (Forge origin)

- Forge hosts bare repos under `/data/git/<slug>.git`. Prefer HTTPS smart HTTP at `/api/git/<slug>.git` (session/Ops/agent token auth). See `docs/git-server.md`.
- Create empty projects, one-shot **Import GitHub**, or **Add local** (empty Forge repo + copy-paste git commands) from the UI; GitHub is not a dual remote after import.
- **Add local:** Forge does not seed commits. If the checkout has no `origin`, add `origin` pointing at Forge. If `origin` already exists, add a `forge` remote and `git config remote.pushDefault forge`. Append a **Git remotes (Forge)** note with `cat >> AGENTS.md` (creates the file if missing). Agents must **push to Forge** (`origin` when that is Forge, otherwise `forge`) and must not `git push origin` to GitHub unless a human asked.
- **Clone tokens (`fgc.*`):** Settings shows a per-repo HTTPS password for humans. It only authorizes git push/pull for that repo. Agents keep using Ops/`fos.*` tokens for git — do not put clone tokens in agent env as Ops credentials.
- When `gitRepositoryId` is set, deploy jobs and agent containers clone from Forge (not GitHub).

## Agent workflow (mandatory)

- **Run `./test.sh` before finishing any task** that touches code or config. Do not end the turn with failing or unrun tests.
- Agents automatically enable Layer C live Forge Redeploy/smoke tests when `FORGE_OPS_API_TOKEN` is a `fos.*` session token (or pass `./test.sh --live-smoke`). Force off with `FORGE_LIVE_SMOKE=0`. Self-update staging never nests live cutover.
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

- **Auth:** Agents get a project-scoped session token in `$FORGE_OPS_API_TOKEN` (`fos.<sessionId>.…`, HMAC via `FORGE_OPS_SESSION_SECRET` or an auto-persisted secret beside the DB). Optional global `FORGE_OPS_API_TOKEN` in `.env` grants full Ops access for CI/curl. Archiving a session revokes its token.
- **Audit:** Every POST/PATCH must include `actionDescription` (10–2000 chars) stating exactly what the agent is doing and why.
- **Session link:** Pass `X-Forge-Agent-Session-Id: <session-id>` to attach ops calls to the agent session audit log (also inferred from session tokens).
- **Catalog:** `GET /api/ops` returns all endpoints and curl examples.
- **Agent prompt:** Forge prepends ops instructions to the first turn of each agent session automatically.

When implementing or debugging ops flows, run `./test.sh` and consult `src/lib/agent-ops-prompt.ts` for the canonical instruction text.
