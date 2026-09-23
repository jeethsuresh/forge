# One-way Forge install migration

**Date:** 2026-09-23  
**Status:** Approved for implementation

## Goal

Global settings on a Forge install (the receiver) can pull projects from another Forge install (the sender). The operator enters the sender’s base URL and that install’s dashboard username and password. The receiver copies projects, Forge-hosted bare git repositories, project configuration, secrets, and Git SSH public keys. The sender is unchanged. Nothing is deployed.

## Copied

| Data | Receiver treatment |
|---|---|
| Projects | New ids. Name, legacy `githubRepo`, watch branch, `enabled`, deploy env, `hostPort`. `lastSeenCommit` is the watch-branch tip when that branch exists in the imported bare repo. `caddyRouteJson` is empty. `clonePath` is a new local path. |
| Bare git repos | Every ref on the sender’s bare repo, including pushed feature branches. New path under this install’s git root. New `fgc.*` clone token. `importedFrom` and default branch are kept. |
| Working copy | One checkout of the watch branch (`git clone --single-branch`). Empty repos get a bare repo and no working copy. |
| Forgefile snapshot, deploy targets, artifact definitions | Copied onto the new project ids. |
| Secrets | Global and project secrets. The sender decrypts them into the manifest. The receiver encrypts them with its own key. Project secrets follow the new project id. |
| Git SSH public keys | Name, key, fingerprint, and scope. A fingerprint that already exists on the receiver is left as-is. |

## Left on the sender

Local working-copy branches, agent sessions, events, containers, and branch workspaces. Caddy routes, access logs, and `caddy_route_json`. Deployment rows, release pins, service-directory runtime, artifact build rows and blobs. Ops audit log. Users. Browser appearance.

The bare repo is the repository. Agent working copies are not copied. A feature branch that was pushed to the sender’s bare repo is part of that repository and is included.

## No deploy

Import does not call deploy, does not run the post-receive hook, and does not sync Caddy. The receiver’s post-receive hook is installed on each new bare repo so a later push can deploy.

`checkProjectForChanges` skips automatic deploy when `lastSeenCommit` equals the remote tip and the project has no deployment rows. Projects that already have deployment history keep today’s retry behavior. The next new commit, or a manual Redeploy, deploys.

## Auth and flow

Only a logged-in receiver admin can start a migration. The password is sent once, to the receiver, which posts it to the sender’s `POST /api/auth/login` and then calls the sender with that session cookie. The password is not stored.

1. **Review** checks the login, downloads the manifest, and shows project names, repo slugs, secret counts, and SSH key counts. Nothing is written.
2. **Import** downloads each bundle and writes rows. The manifest and session cookie are held in receiver memory for up to 10 minutes, then dropped. A successful import drops them immediately.

Sender routes (dashboard session required):

- `GET /api/settings/migration/export` — manifest, schema version 1
- `GET /api/settings/migration/repos/:slug` — `git bundle --all` of that bare repo

Receiver routes (dashboard session required):

- `POST /api/settings/migration/preview`
- `POST /api/settings/migration/apply`

The URL must be `http` or `https`, with no userinfo and no path other than `/`. Redirects are not followed. An `http` URL shows a warning before review, because secrets travel in the manifest. Response bodies are not logged. Manifest schema other than version 1 is rejected. Unknown JSON fields are ignored, so a sender cannot smuggle Caddy config or agent rows into the apply path.

## Conflicts

Import is all-or-nothing. It aborts before creating repos when any incoming project name, compose slug, git slug, or `hostPort` is already used on the receiver, or when a global secret name already exists here, or when the manifest repeats any of those. An SSH key whose fingerprint already exists is skipped. On failure after some files were created, new rows, new bare directories, and new working copies from that attempt are removed.

## Errors

A bad URL, unreachable sender, redirect, or wrong password fails on review. A bundle that is missing or is not a git bundle aborts and rolls back. An unknown manifest version is rejected.

## Tests

The manifest builder omits agents, local workspaces, Caddy, deployments, release pins, and clone tokens, and includes secret plaintext only inside the export object. Apply assigns new ids, re-encrypts secrets, mints new clone tokens, checks out only the watch branch, keeps other bare-repo refs, and refuses conflicts. A bad second bundle removes the first repo. The watcher helper skips a matching `lastSeenCommit` when there are no deployment rows, and does not skip when a deployment row exists. Preview and apply use a fake sender fetch.

## Out of scope

Pushing from the sender, two-way sync, copying users, merging two copies of the same project, and deploying or writing Caddy as part of the import.
