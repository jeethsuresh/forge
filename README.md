# Forge

A local Docker deployment orchestrator with a web dashboard. Forge watches GitHub repositories, detects changes every minute, and automatically builds, tests, and deploys them using each repo's root scripts.

## Features

- **GitHub monitoring** — polls remote branches every 60 seconds for new commits
- **Automated pipeline** — clones/pulls, runs `build.sh`, `test.sh`, then `deploy.sh`
- **Web dashboard** — login-protected UI with project sidebar, deployment history, container status, and live logs
- **SQLite tracking** — persists projects, deployments, and state locally
- **Manual controls** — trigger deploys, pause/resume watching, remove projects

## Prerequisites

- Node.js 20+
- Git
- Docker and Docker Compose
- Network access to GitHub (public repos, or configure git credentials for private repos)

## Setup

```bash
npm install
cp .env.example .env.local
# Edit .env.local — set FORGE_SESSION_SECRET and admin credentials
./build.sh --skip-install
./test.sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with your configured credentials (default: `admin` / `admin`).

## Repository Scripts

Forge and every watched repository should provide executable root scripts with CLI flags:

| Script | Purpose |
|--------|---------|
| `build.sh` | Build the app or Docker image(s) |
| `test.sh` | Run unit tests |
| `deploy.sh` | Deploy via `docker compose up` (containers only) |
| `teardown.sh` | Stop containers/processes and clean up |

Common flags (see `./build.sh --help`): `--project-name`, `--compose-file`, `--host-port`.

Example `build.sh` for a compose-based project:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose build "$@"
```

Example `test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm test
```

Example `deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose up -d "$@"
```

Example `teardown.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose down -v --remove-orphans "$@"
```

Make all four scripts executable (`chmod +x build.sh test.sh deploy.sh teardown.sh`).

## Watched Repository Requirements

Each repository you add must have these files in its root:

- `build.sh` — builds Docker image(s) or app artifacts
- `test.sh` — runs unit tests (pipeline fails if tests fail)
- `deploy.sh` — runs `docker compose up` (or equivalent) to deploy
- `teardown.sh` — stops containers and removes resources
- `docker-compose.yml` — required for `deploy.sh` / `teardown.sh`

## Adding a Project

1. Sign in to the dashboard
2. Click **Add project** in the sidebar
3. Enter a display name, GitHub repo (`owner/repo`), and branch
4. Forge clones the repo to `FORGE_REPOS_DIR` and begins watching

On the first detected change (or a manual **Deploy now**), Forge runs the full pipeline.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGE_SESSION_SECRET` | dev fallback | Iron-session encryption key (32+ chars) |
| `FORGE_ADMIN_USERNAME` | `admin` | Initial admin username |
| `FORGE_ADMIN_PASSWORD` | `admin` | Initial admin password |
| `FORGE_DB_PATH` | `./data/forge.db` | SQLite database path |
| `FORGE_REPOS_DIR` | `./data/repos` | Local clone directory |

## Production

```bash
cp .env.example .env
# Edit .env — set FORGE_SESSION_SECRET and admin credentials
./build.sh
./test.sh
./deploy.sh --host-port 3000
```

Forge runs in Docker with the host container socket mounted so it can deploy watched repositories. On Podman rootless hosts, `deploy.sh` auto-starts `podman.socket` when needed; override with `DOCKER_SOCKET` if required.

## Architecture

```
┌─────────────┐     every 60s      ┌──────────────┐
│   Watcher   │ ────────────────▶  │ GitHub API   │
│ (instrument)│                    │ git ls-remote│
└──────┬──────┘                    └──────────────┘
       │ on change
       ▼
┌─────────────┐   build.sh    ┌──────────────┐
│  Deployer   │ ────────────▶ │ Docker build │
│             │   test.sh     │ unit tests   │
│             │   deploy.sh   │ compose up   │
└──────┬──────┘ ────────────▶ └──────────────┘
       │
       ▼
┌─────────────┐
│   SQLite    │  projects, deployments, logs
└─────────────┘
```
