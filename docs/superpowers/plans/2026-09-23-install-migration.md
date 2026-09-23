# Install migration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Global settings pull projects, bare git repos, configuration, secrets, and Git SSH public keys from another Forge install without deploying.

**Architecture:** The sender builds a versioned JSON manifest and serves one `git bundle` per bare repo. The receiver reviews that manifest, downloads bundles with the sender’s session cookie, and applies them locally with new ids. A watcher guard treats “seen tip, no deployment rows” as do-not-auto-deploy.

**Tech Stack:** Next.js route handlers, better-sqlite3/Drizzle, git bundles, Vitest, existing dashboard session auth.

## Global Constraints

- Schema version is exactly `1`.
- One-way: sender export is read-only.
- Do not copy local working copies, agents, Caddy, deployment history, release pins, service-directory runtime, artifact builds, users, or clone tokens.
- Do not deploy, run post-receive, or sync Caddy during import.
- All-or-nothing conflicts: project name, compose slug, git slug, host port, global secret name.
- SSH public keys with an existing fingerprint are skipped.
- Secrets are decrypted on the sender and re-encrypted on the receiver.
- New `fgc.*` clone tokens on the receiver.
- Working copy is `git clone --single-branch` of the watch branch only.
- Bare repo keeps every pushed ref.
- `lastSeenCommit` is the watch-branch tip when that ref exists.
- Skip auto-deploy only when `lastSeenCommit` equals the remote tip and the project has zero deployment rows.
- Preview holds the manifest and session cookie in memory for at most 10 minutes.
- URL is `http` or `https`, no userinfo, no path other than `/`, no redirects.
- `http` shows a clear-text warning.
- Dashboard session required on every migration route.

---

### Task 1: Manifest, apply, and watcher guard

**Files:**
- Create: `src/lib/migration/manifest.ts`
- Create: `src/lib/migration/apply.ts`
- Create: `src/lib/migration/pull.ts`
- Modify: `src/lib/deployer.ts`
- Test: `src/lib/migration/migration.test.ts`

**Interfaces:**
- Produces: `buildMigrationManifest`, `parseMigrationManifest`, `migrationSummary`, `migrationConflicts`, `applyMigrationManifest`, `createRepositoryBundle`, `parseMigrationBaseUrl`, `previewMigration`, `applyMigrationPreview`, `shouldSkipBaselineAutoDeploy`

- [x] Write failing tests for export filtering, apply, conflicts, rollback, watcher skip, and fake-sender preview.
- [x] Run `npx vitest run src/lib/migration/migration.test.ts` and confirm failure.
- [x] Implement the modules and the deployer guard.
- [x] Re-run the test file until it passes.

### Task 2: HTTP routes and settings tab

**Files:**
- Create: `src/app/api/settings/migration/export/route.ts`
- Create: `src/app/api/settings/migration/repos/[slug]/route.ts`
- Create: `src/app/api/settings/migration/preview/route.ts`
- Create: `src/app/api/settings/migration/apply/route.ts`
- Create: `src/components/MigrationSettings.tsx`
- Modify: `src/components/GlobalSettings.tsx`
- Modify: `src/lib/command-palette/rank.ts`

- [x] Session-gated routes call the Task 1 functions.
- [x] Settings tab collects URL, username, and password, reviews, then imports.
- [x] Palette keywords include migrate.

### Task 3: Gate

- [x] `./build.sh --skip-install`
- [x] `FORGE_LIVE_SMOKE=0 FORGE_UI_E2E=0 ./test.sh` (712 passed, 6 skipped)
- [x] Commit on `feat/install-migration` and merge into `main`.
