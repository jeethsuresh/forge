# Forgefile

Forgefile is the **required** contract between a repository and Forge. Every watched project must have a valid YAML `Forgefile` at the repo root before Forge will run scripts or deploys.

## Why Forgefile

Forge 1.x assumed every repo exposed hardcoded `build.sh` → `test.sh` → `deploy.sh`. That left no way to declare:

- Named maintenance scripts (migrate, seed, …)
- Multiple deploy targets with distinct ports/subdomains
- Which targets auto-deploy on new commits
- Artifacts and agent bootstrap hints

Forgefile makes those declarations explicit. Missing or invalid Forgefiles **fail closed**: pipeline actions are blocked and the UI offers **Create Forgefile with agent**.

## Quick start

1. Copy [`docs/forgefile.template.yml`](./forgefile.template.yml) to `Forgefile` at the repo root.
2. Fill in `project.name` and at least one `deployments` entry with a `scripts.deploy` command.
3. Point build/test/deploy at your existing scripts (often still `./build.sh`, `./test.sh`, `./deploy.sh`).
4. Commit. Forge re-validates and projects the manifest into SQLite before the next script/deploy.

Filename rules:

- Preferred: `Forgefile`
- Alias: `forgefile.yml`
- If both exist with different contents → validation error
- If both exist with identical contents → prefer `Forgefile`

## `version` / `project`

```yaml
version: 1

project:
  name: my-app
  # compose_slug: my-app   # optional override for Docker Compose project name
```

- `version` must be `1`.
- `project.name` is required (non-empty string).
- `compose_slug` is optional; Forge otherwise derives a slug from the project display name.

## `scripts`

Named scripts Forge can run from the UI or Ops API (`POST …/scripts/{name}/run`).

```yaml
scripts:
  build:
    run: ./build.sh
    description: Compile and image-build
  migrate:
    run: ./scripts/migrate.sh
    description: Maintenance; runnable from UI/Ops
```

- Each entry needs a `run` string.
- First token is a script path relative to the repo root (must exist when executed).
- Additional tokens are argv; Forge appends `--project-name` / `--host-port` after them.
- Quoted arguments in `run` are **not** supported yet — use simple whitespace-separated tokens.

## `deployments`

Named deploy targets. At least one is required.

```yaml
deployments:
  web:
    description: Public web app
    auto_deploy: false
    subdomain: web
    compose_slug: my-app-web
    scripts:
      build: build          # reference scripts.build
      test: test
      deploy: ./deploy.sh --target web
      teardown: ./teardown.sh --target web
    ports:
      - name: http
        port: 8080
        public: true
        health:
          path: /api/health
          interval_seconds: 30
```

### Script bindings

| Field | Required | Meaning |
|-------|----------|---------|
| `deploy` | yes | Command or script ref to deploy this target |
| `build` | no | Run before deploy when present |
| `test` | no | Run after build when present |
| `teardown` | no | Declared for stop/cleanup flows |

Values are either:

- **Script refs** — bare names that exist under `scripts` (e.g. `build`)
- **Inline runs** — strings containing `/`, starting with `.`, or including spaces (e.g. `./deploy.sh --target web`)

### Ports

- `name` — logical name (`http`, `metrics`, …)
- `port` — host port 1–65535; **must be unique across all deployments** in the file
- `public` — whether the port is intended for public routing (default `false`)
- `health` — optional `{ path, interval_seconds }` for future monitoring (Plan 2)

### Other fields

- `auto_deploy` — default `false`. When `true`, the watcher deploys this target on new commits.
- `subdomain` — optional Caddy/service-directory hint (wiring lands in later plans)
- `compose_slug` — optional per-target Compose project name override

### Env / CLI Forge injects

When running bound scripts, Forge sets:

- `FORGE_DEPLOYMENT=<target-name>`
- `--project-name` / `--host-port` (and matching env) from project routing settings

## `artifacts`

Declare buildable file artifacts. Forge runs the build as a privileged job in the project checkout, stores the output on disk, and offers authenticated download from the UI and Ops API.

```yaml
artifacts:
  linux-amd64:
    description: CLI binary
    build: ./scripts/build-artifact.sh linux-amd64
    path: dist/my-app-linux-amd64
    content_type: application/octet-stream
```

| Field | Required | Notes |
|-------|----------|-------|
| `build` | yes | Inline command or `scripts.*` reference |
| `path` | yes | Output path relative to repo root (must exist after build) |
| `description` | no | Shown in UI |
| `content_type` | no | Defaults to `application/octet-stream` |

### Build + download

- **UI:** Project Overview / Deploy → Artifacts panel (Build / Download)
- **Dashboard API:** `GET /api/projects/{id}/artifacts`, `POST …/artifacts/{name}/build`, `GET …/artifacts/{name}/builds/{buildId}/download`
- **Ops API:** same paths under `/api/ops/…` (POST requires `actionDescription`)
- Failed builds keep an error row; Download is only available on `success`
- Retention keeps the last 10 successful builds per artifact name (older success builds are deleted from disk + DB)

Artifacts are **file** downloads. Image release pins under `releases/*.json` remain a separate deploy-rollback mechanism.
## `agent`

Non-secret bootstrap hints for future agent containers:

```yaml
agent:
  packages: []   # optional package install hints
```

## Validation rules + pickup

Forge validates on load:

- `version === 1`, non-empty `project.name`, ≥1 deployment
- Each deployment has `scripts.deploy`
- Script refs resolve to `scripts.*`
- Port numbers unique across deployments
- Defaults: `auto_deploy: false`, `ports: []`, `artifacts: {}`, `agent.packages: []`

**Pickup:** after every pull/checkout (and before script/deploy/artifact build), Forge reloads the Forgefile, re-validates, and reconciles SQLite (`project_forgefiles`, `deploy_targets`, `artifacts`, service directory). Stale projections are replaced when the content hash changes.

## Running scripts from UI/Ops

- Dashboard: `POST /api/projects/{id}/scripts/{name}/run`
- Ops: `POST /api/ops/projects/{id}/scripts/{name}/run` with `actionDescription`
- Status: `GET …/forgefile` returns projection status, parsed manifest, and deploy targets
- Deploy: pass optional `deployment` to select a target when multiple exist

## Migrating from bare build/test/deploy

1. Keep your existing `build.sh` / `test.sh` / `deploy.sh` / `teardown.sh`.
2. Add a Forgefile that references them:

```yaml
version: 1
project:
  name: my-app
scripts:
  build:
    run: ./build.sh
  test:
    run: ./test.sh
deployments:
  app:
    auto_deploy: false
    scripts:
      build: build
      test: test
      deploy: ./deploy.sh
      teardown: ./teardown.sh
    ports:
      - name: http
        port: 8080
        public: true
```

3. Commit. Manual/auto deploys now go through the Forgefile gate.

## Bootstrap agent CTA

When status is `missing` or `invalid`, the project Overview/Deploy tabs show **Create Forgefile with agent**. That starts a normal agent session with a fixed prompt instructing the agent to author a valid `version: 1` Forgefile from `docs/forgefile.template.yml` and commit it — without deploying until validation passes.

## Full example

See [`docs/forgefile.template.yml`](./forgefile.template.yml) for every option (unused fields commented). Forge’s own root `Forgefile` is a minimal production example.
