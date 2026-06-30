# Forge

A local Docker deployment orchestrator with a web dashboard. Forge watches GitHub repositories, detects changes every minute, and automatically builds and deploys them using each repo's `build.sh` and `deploy.sh` scripts.

## Features

- **GitHub monitoring** — polls remote branches every 60 seconds for new commits
- **Automated pipeline** — clones/pulls, runs `build.sh`, then `deploy.sh`
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
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with your configured credentials (default: `admin` / `admin`).

## Watched Repository Requirements

Each repository you add must have these files in its root:

- `build.sh` — builds Docker image(s)
- `deploy.sh` — runs `docker compose` (or equivalent) to deploy
- `docker-compose.yml` (optional) — enables container status in the dashboard

Example `build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
docker compose build
```

Example `deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
docker compose up -d
```

Make sure both scripts are executable (`chmod +x build.sh deploy.sh`).

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
npm run build
npm start
```

The background watcher starts automatically via Next.js instrumentation when the server boots.

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
│             │   deploy.sh   │ compose up   │
└──────┬──────┘ ────────────▶ └──────────────┘
       │
       ▼
┌─────────────┐
│   SQLite    │  projects, deployments, logs
└─────────────┘
```
