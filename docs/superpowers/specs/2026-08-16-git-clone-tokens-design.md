# Per-repo git clone tokens

**Date:** 2026-08-16  
**Status:** Approved for implementation  
**Related:** `docs/git-server.md`, `src/lib/git-http.ts`, `src/components/GitHttpsCredentials.tsx`

## Goal

Give each Forge-hosted git repository a dedicated **clone token** that Settings (and Add-project success) can show as a real Basic-auth password for `git push` / `git pull` / `git clone`. The token must authorize **only** smart HTTP for that repo—not Ops, dashboard APIs, or other repos.

## Decisions

| Topic | Choice |
|-------|--------|
| Scope | One token per `git_repositories` row |
| Storage | Plaintext column on `git_repositories` (always readable in UI + recipes) |
| Format | `fgc.<shortId>.<secret>` — distinct from `fos.*` and global Ops tokens |
| Show | Always visible when logged into dashboard; copy buttons |
| Recipes | Embed `https://git:<token>@…` in push/clone examples |
| Rotate | Regenerate in Settings; old token invalid immediately |
| Ops / other APIs | Must reject `fgc.*` (fail closed) |

## Architecture

### Data

Add `cloneToken` (`clone_token`) text column on `git_repositories`, unique when non-null.

- Mint when creating empty / import / add local.
- Lazy-mint on project detail / Settings read if missing (existing repos).
- Regenerate replaces the value.

### Auth (`authorizeGitHttpAccess`)

Order:

1. Dashboard session cookie → ok (`actor: "session"`).
2. Ops global / `fos.*` session (existing) → ok when scoped correctly.
3. Else Basic/Bearer password equals **this** repo’s `cloneToken` → ok (`actor: "git-clone"`).
4. Else 401.

Clone token for slug A must not authorize slug B.

**Isolation:** `authenticateOpsRequest` must not accept `fgc.*` as global or session Ops auth. Clone tokens are checked **only** inside git HTTP authorization.

### API

- Project GET (and list enrichment if needed): `gitCloneUsername: "git"`, `gitCloneToken: "<token>"` for logged-in dashboard users when a Forge git repo is linked.
- `POST /api/projects/:id/git-clone-token/regenerate` — session auth; returns new token; regenerates if missing.

Do not expose clone tokens on unauthenticated or Ops catalog responses unless explicitly needed later (v1: dashboard session only).

### UI

- `GitHttpsCredentials` takes the real token (and optional regenerate handler on Settings).
- Password field shows the actual `fgc.…` value, not help text.
- Push recipes / HTTPS examples use `git:<token>` in the URL.
- Settings: Regenerate button with brief confirmation (token will stop working for existing remotes).

### Agents

Unchanged: agents continue to use Ops / `fos.*` for git. Clone tokens are for humans and local credential helpers. Document in `docs/git-server.md` and Forge `AGENTS.md` briefly.

## Errors

- Regenerate without linked git repo → 400.
- Wrong clone token / other repo’s token → 401/403 on git HTTP.
- Ops call with clone token as Bearer → 401 Unauthorized.

## Tests

- Mint on create; column populated.
- Git HTTP: matching clone token allows upload-pack and receive-pack for that slug.
- Git HTTP: token for another slug denied.
- Ops `authenticateOpsRequest` / a sample Ops route: `fgc.*` rejected.
- Regenerate changes token; old token fails; new token succeeds.
- Recipes / credential helper include the real token when passed into UI helpers (unit test on recipe builder with token arg).

## Out of scope

Multiple tokens per repo, expiry, hash-only storage, SSH deploy keys changes, embedding tokens in Ops API responses.
