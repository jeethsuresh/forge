# Set up Forge on a new machine

Use this when installing Forge on a host that does not already run it. A clone of this repo is not a running Forge: the database, project checkouts, and bare git repos live in the `forge-data` Compose volume.

After the first successful host deploy, leave `./deploy.sh` alone. Later upgrades are **Update Forge** on the Forge project, or `POST /api/ops/projects/{id}/deploy`. Host `./deploy.sh` is only for a machine where `forge_app_1` is not running. Running it while Forge is up leaves the container in a state the self-updater cannot recreate.

Local `npm run dev` is in the README **Setup** section. This guide is the production host path.

## Prerequisites

- Node.js 20+
- Git
- Docker or Podman, available as the `docker` CLI (on Fedora this is often Podman)
- Cursor agent CLI on the host, so `~/.local/bin/agent` exists

`./deploy.sh` exits if it cannot find the agent binary (`~/.local/bin/agent`, or the newest `~/.local/share/cursor-agent/versions/*/cursor-agent`). It also needs credentials: run `agent login` on the host, or set `FORGE_CURSOR_API_KEY` in `.env`.

`./deploy.sh` starts a user systemd unit, `podman-forge-api.service`, listening on `tcp://127.0.0.1:18765`. That TCP API is how the Forge container talks to Podman. Enable lingering so it survives logout:

```bash
loginctl enable-linger "$USER"
```

Caddy is optional. Install it only if Forge should push project routes and tail access logs. The admin API default is `http://127.0.0.1:2019` (`FORGE_CADDY_ADMIN_URL`).

## Fresh install

```bash
git clone <forge-repo-url> forge
cd forge
cp .env.example .env
```

Edit `.env` before the first boot:

| Variable | Purpose |
|---|---|
| `FORGE_SESSION_SECRET` | Session encryption. Use 32 or more random characters. |
| `FORGE_ADMIN_USERNAME` / `FORGE_ADMIN_PASSWORD` | First dashboard login. Defaults are `admin` / `admin`. |
| `FORGE_CURSOR_API_KEY` | Required only when `agent login` was not run on the host. |
| `FORGE_GITHUB_TOKEN` | Private GitHub clones and one-shot GitHub imports. |
| `FORGE_SELF_REPO` | `owner/repo` of this Forge checkout. Startup creates the Forge project row and clones that repo to `/data/forge-source`, which later UI updates need. |
| `FORGE_SELF_BRANCH` | Branch for that checkout. Default `main`. |
| `FORGE_GIT_USER_NAME` / `FORGE_GIT_USER_EMAIL` | Identity for commits agents make. |

Leave `FORGE_CURSOR_AGENT_DIR`, `FORGE_CURSOR_CONFIG_DIR`, and `DOCKER_SOCKET` unset. `./deploy.sh` detects them and writes the host paths to `/data/forge-host-mounts.json` so later self-updates can remount the agent CLI.

Then:

```bash
./build.sh
./test.sh
./deploy.sh --project-name forge --host-port 3000 --detach
```

That builds `forge-app`, starts `forge_app_1` (`network_mode: host`, `userns_mode: keep-id`), and mounts the Compose volume `forge_forge-data` at `/data`:

| Path in the container | Contents |
|---|---|
| `/data/forge.db` | SQLite database |
| `/data/repos` | Project working copies |
| `/data/git/<slug>.git` | Forge bare repos |
| `/data/forge-source` | Forge's own checkout, when `FORGE_SELF_REPO` is set |

Open `http://localhost:3000` and sign in. Check `GET /api/forge/health`.

## After the first boot

- Add work from the sidebar: **New project**, **Import GitHub**, or **From image**. Every watched repo needs a valid root `Forgefile`. See `docs/Forgefile.md`.
- HTTPS git is `https://<forge-host>/api/git/<slug>.git`. Clone tokens (`fgc.*`) are per-repo passwords shown in project Settings. See `docs/git-server.md`.
- SSH git is optional. Add keys under **Global settings → Git SSH**, then:

  ```bash
  docker compose -p forge --profile git-ssh up -d git-ssh
  ```

  Default host port is 2222 (`FORGE_GIT_SSH_PORT`).

Pass `--project-name forge` on every Compose command. The implicit directory name is not the project name.

## Move an existing Forge

Copy the `forge_forge-data` volume and the host `.env` onto the new machine, then run the same `./build.sh`, `./test.sh`, and `./deploy.sh --project-name forge --host-port 3000 --detach` sequence. Cloning the git repo alone does not bring projects, sessions, or bare repos.

Confirm nothing else is bound to port 3000 or `18765` before that deploy. If a port is taken, pick another `--host-port`. Do not stop whatever is already listening.
