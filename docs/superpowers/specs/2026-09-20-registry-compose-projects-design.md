# Registry images, compose studio, and unified new project

**Date:** 2026-09-20  
**Status:** Approved for implementation  
**Related:** `docs/git-server.md`, `docs/Forgefile.md`, `src/lib/git-repo.ts`, `src/lib/project-routes.ts`

## Goal

1. Create a Forge project from a Docker Hub / GHCR / other registry image, seed a full deployable git contract, deploy immediately, then open a compose editor.
2. Give every project a Compose studio (form + YAML) whose saves are git-branch commits with one-click merge/deploy.
3. Collapse **Create empty** and **Add local** into one **New project** flow: seed README + Forgefile, optionally import a host folder as a second commit, then start a bootstrap agent.

## Decisions

| Topic | Choice |
|-------|--------|
| Image project git | Normal Forge contract: Forgefile, `build.sh` / `test.sh` / `deploy.sh` / `teardown.sh`, `scripts/lib/common.sh`, `docker-compose.yml`, `.env` + `.env.example` |
| Image create UX | New **From image** mode; auto-deploy; land on Compose studio |
| Registry auth | Per-project deploy-env secrets; isolated `DOCKER_CONFIG` per deploy/build; never commit passwords |
| Compose editor | All projects; create compose if missing |
| GUI vs YAML | Form for common service fields; unknown keys shown collapsed view-only; YAML toggle for full text |
| Compose save | New branch `forge/compose-<utc>`; **Merge & deploy** merges into watch branch then deploys |
| New project | One mode; always seed; optional `hostPath`; bootstrap agent; `mode=local` aliases this |
| Host import | Snapshot copy excluding source `.git`; include `.gitignore`; `git add` honors ignore |
| From-image agent | Do not auto-start; compose/scripts already seeded |

## Architecture

```
/projects/new
  New project  → POST mode=create (+ hostPath?) → seed → optional import → agent → /projects/:id/agents
  Import GitHub → unchanged
  From image   → POST mode=image → image seed pack → deploy env + hostPort → deploy → /projects/:id/compose

/projects/:id/compose
  GET/PUT compose YAML (or structured form) on forge/compose-* branch
  POST merge-deploy → mergeProjectBranch + deployProject
```

Host-folder copy: if the path exists in the Forge process, copy with `fs`. Otherwise copy via a helper container that bind-mounts the host path and the clone (using `resolveHostBindPath`). Logged-in dashboard only.

## Image reference

Accept Docker-style references: `nginx`, `nginx:latest`, `docker.io/library/nginx:1.27`, `ghcr.io/org/app:1.2`, `registry.example.com:5000/ns/app@sha256:…`.

Reject whitespace and shell metacharacters (`$`, `` ` ``, `;`, `|`, `&`, newlines). Parse host, repository, tag or digest.

Default project display name: last path segment of the repository (strip tag/digest).

## Image seed pack

Working clone files (all scripts executable, parse `--project-name` / `--host-port` via a **small** `scripts/lib/common.sh` — not Forge’s own production helper):

- **Forgefile** — `build`/`test`/`deploy`/`teardown`; one `web` deployment; `auto_deploy: false`; public http port = inspected/fallback container port.
- **build.sh** — `docker pull "${IMAGE:?}"` (login is injected by Forge around script runs).
- **test.sh** — `docker compose … config` (validity only).
- **deploy.sh** / **teardown.sh** — `compose up -d` / `compose down --remove-orphans`.
- **docker-compose.yml** — service **`app`**, `image: ${IMAGE}`, `"${HOST_PORT}:${CONTAINER_PORT}"`, `restart: unless-stopped`, `env_file: .env`.
- **`.env` / `.env.example`** — `IMAGE`, `CONTAINER_PORT`. No registry password.

Container port: optional form field; else inspect `ExposedPorts` after pull; else `8080`.  
Host port: optional; else `pickFreePort(3456)` (existing helper). Stored on `projects.host_port` and Forgefile public port.

## Registry credentials

Deploy env keys (secret where noted):

- `IMAGE` (non-secret)
- `CONTAINER_PORT` (non-secret)
- `FORGE_REGISTRY_URL` (optional; default from image host)
- `FORGE_REGISTRY_USER`
- `FORGE_REGISTRY_PASSWORD` (secret)

Before `build`/`test`/`deploy`/`teardown` script runs, if user+password are set: create a temp `DOCKER_CONFIG`, `docker login --password-stdin`, pass that env into the script, delete the dir afterward. Do not use the host `~/.docker`.

Failed pull/login: project remains; operator fixes Settings deploy env and retries deploy.

## Unified New project

`POST /api/projects` `mode: "create" | "local"`:

1. `createForgeGitRepository({ seed: true })` — README + Forgefile root commit (existing behavior).
2. If `hostPath` is set: validate absolute directory; copy excluding `.git`; `git add -A` + migratory commit `chore: import local project files`; push to origin. If the import overwrites seed README/Forgefile, that is intended.
3. Start `createAgentSession` on the watch branch with a bootstrap prompt (valid Forgefile, compose file with `app` + `HOST_PORT`, rewrite README, no secrets in git). Failure to spawn the agent does not roll back the project.
4. Response includes `agentSessionId` when started. UI redirects to `/projects/:id/agents?session=…`.

`mode=local` must not create an unseeded repo.

Keep Settings clone URLs / push recipes for operators who push later. They are not a separate create mode.

## Compose studio

New `ProjectMode` `compose` → `/projects/:id/compose` (sidebar + palette).

File discovery matches `src/lib/docker.ts`: `docker-compose.yml`, `docker-compose.yaml`, `compose.yml` (first existing). Empty state: **Create docker-compose.yml** writes the image-style starter onto a new compose branch.

**Form (editable):** per service — `image` / `build`, ports, environment, volumes, restart, `depends_on`, healthcheck, command/entrypoint, networks, `extra_hosts`. Top-level `networks` / `volumes` that the form creates.

**View-only:** every other key, collapsed, hint “edit in YAML”.

**YAML mode:** full text. Invalid YAML blocks save. Switching YAML → form reparses; stay on YAML with error if parse fails.

Form save: `yaml.parse` → apply form fields → `yaml.stringify`, preserving unknown keys. Comments may be lost on form save; YAML mode saves exact text.

Warn if no service named `app`. Do not rename services silently.

Optional sibling `.env` editor on the same page (repo file, non-secrets). Registry secrets stay in Settings deploy env.

## Git save / merge / deploy

Save:

1. From watch-branch HEAD, create `forge/compose-<utc>` (ISO compact, filesystem-safe).
2. Write compose (and `.env` if edited).
3. Commit as Forge identity; push to origin.
4. UI shows branch + **Merge & deploy**.

Merge & deploy: `mergeProjectBranch(composeBranch, watchBranch)` then `deployProject`. Conflicts → 409, keep compose branch.

Image projects: `auto_deploy` remains false so compose-branch pushes do not ship until merge-deploy.

When the form changes the `app` published host port, update `projects.hostPort` and Forgefile public port in the **same compose-branch commit** if those files are in the repo.

## APIs

- `POST /api/projects`  
  - `create`/`local`: `{ name, slug?, branch?, hostPath? }`  
  - `image`: `{ name?, slug?, branch?, image, containerPort?, hostPort?, registryUser?, registryPassword? }`  
  - `import`: unchanged
- `GET /api/projects/:id/compose` — `{ fileName, yaml, envText, warnings[], composeBranch, watchBranch }`
- `PUT /api/projects/:id/compose` — `{ yaml, envText?, mode: "form" | "yaml" }` → `{ branch, commitSha }`
- `POST /api/projects/:id/compose/create` — starter file on a new branch
- `POST /api/projects/:id/compose/merge-deploy` — `{ branch }` merge into watch branch + deploy

## Errors

| Case | Behavior |
|------|----------|
| Bad image ref | 400, no project |
| Pull/login fail after seed | Project kept; deploy logs explain |
| Bad hostPath | 400; if seed already happened, keep project, no agent |
| Invalid compose YAML on save | 400 |
| Merge conflict | 409 |
| Missing `app` service | Warning; deploy may fail rollback tagging |
| Agent spawn fail | Project kept; error on create response |

## Testing

- Image ref parse accept/reject cases
- Image seed Forgefile valid; compose has `app`; password not in git
- `mode=image` stores secret deploy env
- Isolated `DOCKER_CONFIG` login helper (mocked docker)
- `mode=create` seeds README+Forgefile; `mode=local` same
- `hostPath` skips `.git`, keeps `.gitignore`, does not add `node_modules` when ignored
- Compose PUT uses `forge/compose-*` and does not move watch branch until merge-deploy
- Form round-trip preserves unknown keys
- `projectModePath` / resolve for `compose`
- Import GitHub unchanged

## Out of scope

- Hub tag polling
- Multiple compose files / `include`
- Forgefile GUI (bootstrap agent + existing YAML in git)
- Dockerfile wizard on From image
- Shared global registry credential store
- Importing git history from the host folder
- Browser zip/folder upload

## Docs / copy

Update `docs/git-server.md`, `AGENTS.md`, command palette, Settings hints: three create paths — New project, Import GitHub, From image.
