# Add local projects (Forge as remote)

**Date:** 2026-08-15  
**Status:** Approved for implementation  
**Related:** `docs/git-server.md`, `AGENTS.md` (Forge origin rules)

## Goal

Let operators attach an existing local git checkout to Forge the same way GitHub’s empty-repo page works: create a Forge-hosted bare repo, then copy-paste git commands. No host CLI.

## Decisions

| Topic | Choice |
|-------|--------|
| UI | Third Add project mode: **Add local** (keep Create empty and Import GitHub) |
| History at create | Unseeded bare repo (no README/Forgefile/commit) so the first push fast-forwards |
| Host CLI | None |
| Remotes | If no `origin`, add `origin` → Forge. If `origin` exists, add `forge` and `git config remote.pushDefault forge` |
| Local `AGENTS.md` | Recipes **append** with `cat >> AGENTS.md` (creates the file if missing) |
| Working clone | Do not `git clone` empty bare at create; post-receive `cloneOrPull` after first push |
| Default branch | Form value stored on `projects.branch`; v1 does not rewrite it from the first pushed ref |

## Architecture

`POST /api/projects` gains `mode: "local"` beside `create` and `import`.

- Same uniqueness rules as create (display name, compose slug, git slug).
- Init bare repo under `/data/git/<slug>.git`, `http.receivepack=true`, `HEAD` → default branch, post-receive hook.
- Insert `git_repositories` (`importedFrom` null) and `projects` (`githubRepo` empty, `gitRepositoryId` set).
- Persist `clonePath` as `workingClonePathForSlug(slug, branch)` **without** requiring the directory yet.
- Response `201`: project row plus `httpsCloneUrl`, `sshCloneUrl`, `gitSlug`.

Create empty stays seeded. Import GitHub stays one-shot mirror.

## UI

`/projects/new`: third mode button **Add local**. Fields match Create empty (name required, optional slug, default branch). Helper: empty hosted repo; push from the checkout.

On success, stay on a **push instructions** panel (GitHub-style) with a link into the project. Copy buttons on recipes and URLs. Do not silent-redirect to the studio.

Settings **Clone URLs**: show the same recipes while the repo has no commits (or a collapsed “Push an existing repository” block). After first push, drop the empty-state banner; keep URLs.

Update home/studio copy that currently lists only Create empty | Import GitHub.

## Command recipes

HTTPS is the default copy block. Password placeholder, not a live token. Auth reminder: session cookie, Ops/session bearer, or Basic password = token (`docs/git-server.md`). SSH is secondary (URL + keys in Global settings). Do not instruct force-push.

Placeholder clone form:

```bash
git clone https://x:<OPS_OR_SESSION_TOKEN>@<host>/api/git/<slug>.git
```

### Recipe A — no `origin` (new folder or unconfigured repo)

```bash
cd /path/to/repo
git init   # skip if already a repo
git remote add origin <https-url>
cat >> AGENTS.md << 'EOF'
## Git remotes (Forge)

Push to Forge by default. If `origin` is this Forge URL, use `git push -u origin <branch>`.
Do not `git push origin` when `origin` still points at GitHub unless a human asked to update GitHub.
Deploy and agents clone from Forge when this project has a Forge git repository.
EOF
git add AGENTS.md
git commit -m "docs: push to Forge by default"
git push -u origin <default-branch>
```

### Recipe B — `origin` already exists

```bash
cd /path/to/repo
git remote add forge <https-url>
git config remote.pushDefault forge
cat >> AGENTS.md << 'EOF'
## Git remotes (Forge)

The push default remote is `forge` (not GitHub `origin`). Use `git push` / `git push -u forge <branch>`.
Do not `git push origin` unless a human asked to update GitHub.
Deploy and agents clone from Forge when this project has a Forge git repository.
EOF
git add AGENTS.md
git commit -m "docs: push to Forge by default"
git push -u forge <default-branch>
```

`cat >> AGENTS.md` creates the file if missing and appends if it already exists. Recipes must not use `>` (overwrite).

## First push

Existing post-receive → `processPostReceiveNotify` → `cloneOrPull` populates the working clone, picks up Forgefile, wakes auto_deploy. If `cloneOrPull` cannot clone an empty-then-filled bare, extend it so the first notify succeeds.

Deploy/agents stay blocked until a commit and a valid Forgefile exist.

v1 does not auto-change `projects.branch` if the first push is a different branch.

## Errors

- 409: compose name conflict, git slug taken, bare path exists (same as create).
- 400: missing name, invalid slug/branch.
- Push auth unchanged.

## Docs

- Forge `AGENTS.md`: Add local; unseeded repo; origin-vs-forge; agents must append the local `AGENTS.md` note and push to Forge.
- `docs/git-server.md`: third create path; no seed; command-panel behavior.

## Tests

- Unseeded create: bare exists, `HEAD` on default branch, **zero commits**, hook installed, project linked, clone dir not required.
- API: `mode=local` 201 + clone URLs; missing name 400; slug conflict 409.
- New-project UI: third mode; after create, recipes include `origin`, `forge`, and `cat >> AGENTS.md`.
- First push into unseeded repo: notify + `cloneOrPull` succeeds.

## Out of scope

Host CLI, bundle upload, host-path import into the container, rewriting GitHub `origin`, seeding Forgefile on Add local, Ops-only create endpoint, auto-changing `projects.branch` from first push.
