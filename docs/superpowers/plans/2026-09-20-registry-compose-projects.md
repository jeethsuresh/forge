# Registry compose projects Implementation Plan

> **For agentic workers:** Tasks are tightly coupled; implement in this worktree only (`/home/jeeth/js/forge/.worktrees/registry-compose-projects`). Never edit `/home/jeeth/js/forge` outside this worktree. REQUIRED: TDD, `./test.sh` before finish. Never run Forge `./deploy.sh`.

**Goal:** From-image projects, compose studio (form+YAML, branch save, merge-deploy), and unified New project with optional host-folder import + bootstrap agent.

**Architecture:** Pure helpers for image refs, seed files, host import, compose YAML model, and docker login isolation. Wire them into `POST /api/projects`, new `/api/projects/[id]/compose*` routes, `executeDeployment` env, and ProjectStudio `compose` mode.

**Tech Stack:** Next.js App Router, vitest, `yaml` package, existing `git-workspace` / `mergeProjectBranch` / `deployProject` / `createAgentSession`.

## Global Constraints

- Work only in the `feat/registry-compose-projects` worktree. Do not touch the primary checkout.
- Compose rollback still requires a service named `app`.
- Registry passwords never written to git.
- `mode=local` aliases seeded `create`.
- Compose saves go to `forge/compose-<utc>` branches, not the watch branch.
- Image projects `auto_deploy: false`.
- Scripts accept `--project-name` and `--host-port`.
- Exhaustive `switch` on `ProjectMode`.
- Imports at top of files.

---

### Task 1: Image ref parser + seed files

**Files:**
- Create: `src/lib/docker-image-ref.ts`
- Create: `src/lib/docker-image-ref.test.ts`
- Create: `src/lib/git-seed-image-project.ts`
- Create: `src/lib/git-seed-image-project.test.ts`

**Produces:** `parseDockerImageRef(input: string): { ok: true; image: string; nameHint: string; registryHost: string | null } | { ok: false; error: string }`  
`buildImageProjectSeed(opts: { projectName: string; image: string; containerPort: number }): { files: Record<string, string>; executable: string[] }`

- [ ] Failing tests for parse (good refs, reject `$`, spaces) and seed (Forgefile valid, compose `app`, `.env` has IMAGE, no password).
- [ ] Implement parser + seed (minimal `scripts/lib/common.sh`, build/test/deploy/teardown).
- [ ] Tests pass. Commit.

### Task 2: Isolated docker login + image create API

**Files:**
- Create: `src/lib/docker-registry-auth.ts`
- Create: `src/lib/docker-registry-auth.test.ts`
- Modify: `src/lib/git-repo.ts` — optional `seedFiles` map after default README/Forgefile OR `seedKind: "image"` writing image pack
- Modify: `src/lib/deployer.ts` — wrap script env with registry auth temp config when credentials present
- Modify: `src/app/api/projects/route.ts` — `mode: "image"`
- Modify: `src/lib/deploy-env.ts` usage to persist IMAGE + secrets
- Test: `src/app/api/projects/route.test.ts` or extend `git-repo.test.ts` + API test if pattern exists

**Produces:** `withRegistryDockerConfig(vars, run): Promise<T>` sets `DOCKER_CONFIG` temp dir.

- [ ] Tests: login helper uses temp dir; image create stores secret password not in clone files; hostPort set.
- [ ] Implement. Commit.

### Task 3: Unified create + hostPath import + bootstrap agent

**Files:**
- Create: `src/lib/git-import-host-path.ts`
- Create: `src/lib/git-import-host-path.test.ts`
- Create: `src/lib/project-bootstrap-agent.ts` (prompt constant + `startProjectBootstrapAgent`)
- Modify: `src/app/api/projects/route.ts` — `local` seeds; `hostPath`; start agent
- Modify: `src/lib/git-repo.test.ts` — local via API still seeds (keep `seed: false` on low-level helper)

**Produces:** `importHostDirectoryToRepo({ hostPath, clonePath }): Promise<void>`  
Bootstrap prompt lists Forgefile, compose `app`, README, no secrets.

- [ ] Tests: skip `.git`, keep `.gitignore`, ignore `node_modules`; reject relative path; local mode seeds.
- [ ] Implement copy (fs when path exists; docker helper otherwise).
- [ ] Commit.

### Task 4: Compose model + git save + APIs

**Files:**
- Create: `src/lib/compose-document.ts` (+ test)
- Create: `src/lib/compose-studio.ts` (+ test) — discover file, warnings, save on branch, merge-deploy
- Create: `src/app/api/projects/[id]/compose/route.ts`
- Create: `src/app/api/projects/[id]/compose/create/route.ts`
- Create: `src/app/api/projects/[id]/compose/merge-deploy/route.ts`
- Modify: `src/lib/docker.ts` — export `findComposeFile` / `COMPOSE_FILES` if not already exported

**Produces:** parse/stringify unknown-key preservation; `EDITABLE_SERVICE_KEYS`; warnings for missing `app`.

- [ ] Tests: round-trip extra keys; invalid YAML; PUT creates `forge/compose-` branch; merge-deploy mocked.
- [ ] Implement. Commit.

### Task 5: Compose mode routing + UI + new project form

**Files:**
- Modify: `src/lib/project-routes.ts` + tests — add `compose`
- Create: `src/app/(dashboard)/projects/[id]/compose/page.tsx`
- Create: `src/components/ComposeStudio.tsx`
- Modify: `src/components/ProjectStudio.tsx` — `activeTab === "compose"`
- Modify: `src/components/Sidebar.tsx` (via PROJECT_MODES)
- Modify: `src/lib/command-palette/rank.ts`
- Modify: `src/app/(dashboard)/projects/new/page.tsx` — three modes
- Modify: `docs/git-server.md`, `AGENTS.md`

- [ ] Tests for routes.
- [ ] UI: Form | YAML toggle, unknown keys collapsed, Merge & deploy, create-if-missing, hostPath field, From image fields.
- [ ] Commit.

### Task 6: Verify

- [ ] `./build.sh --skip-install` and `./test.sh` in the worktree (custom `--project-name` if compose is used; unit tests are default).
- [ ] Fix failures. Commit if needed.

Do not merge to the primary working tree. Merge `feat/registry-compose-projects` into `main` **from this worktree** only (`git checkout main` here is the worktree, not the other agent’s copy).
