# Forge as git server

Forge hosts bare repositories under `/data/git/<slug>.git` (override with `FORGE_GIT_DIR`).

## Clone URLs

| Transport | URL |
|-----------|-----|
| HTTPS (smart HTTP) | `https://<forge-host>/api/git/<slug>.git` |
| SSH | `git@<host>:<slug>.git` |

### HTTPS auth

- Dashboard session cookie (browser / cookie-aware clients)
- `Authorization: Bearer <FORGE_OPS_API_TOKEN>` (global Ops)
- `Authorization: Bearer fos.<sessionId>.…` (agent session Ops token; project-scoped)
- **Per-repo clone token** (`fgc.…`): Git Basic username `git`, password = the clone token shown on project Settings. Authorizes **only** smart HTTP for that slug — not Ops or other APIs.
- Git Basic auth with Ops/agent token: username any (prefer `git`), password = Ops/agent token

Example with clone token:

```bash
git clone https://git:<CLONE_TOKEN>@<forge-host>/api/git/my-app.git
```

Example with Ops token:

```bash
git clone https://git:<OPS_OR_SESSION_TOKEN>@<forge-host>/api/git/my-app.git
```

Regenerate the clone token from **Settings → Clone URLs** if it leaks; remotes using the old password stop working.
### SSH auth

1. Add public keys in **Global settings → Git SSH**.
2. Forge writes `/data/git-ssh/authorized_keys` (override with `FORGE_GIT_SSH_DIR`).
3. Run an sshd that uses that file and `git-shell` / force-command into the bare root.

A reference sidecar is sketched in `docker-compose.yml` under the `git-ssh` profile:

```bash
# After keys are registered in the UI:
docker compose -p forge --profile git-ssh up -d git-ssh
```

Set `FORGE_GIT_SSH_HOST` (or `FORGE_PUBLIC_HOST`) so the UI shows the correct `git@host:slug.git` URL.

Smart HTTP is the supported path in unit tests; SSH is optional host infrastructure.

## Create vs import vs local

- **Create empty** — seed README + minimal `Forgefile`, Forge is origin.
- **Import GitHub** — one-shot `git clone --mirror` into Forge bare store; no ongoing dual-remote sync in v1.
- **Add local** — empty bare repo (no seed commit). The UI shows GitHub-style commands:
  - no `origin`: `git remote add origin <https-url>` then push
  - existing `origin`: `git remote add forge <https-url>` and `git config remote.pushDefault forge`
  - always `cat >> AGENTS.md` to append (or create) a note that agents push to Forge

Existing GitHub-only projects: use Import (or Add local + push) so agents and deploy jobs clone from Forge.
