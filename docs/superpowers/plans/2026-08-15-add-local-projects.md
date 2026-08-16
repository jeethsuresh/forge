# Add Local Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third Add-project mode that creates an unseeded Forge bare repo and shows GitHub-style git commands (including `cat >> AGENTS.md`) so a local checkout can push to Forge.

**Architecture:** `createForgeGitRepository({ seed: false })` inits bare + DB without seed commit or working clone. Recipes live in a pure helper so UI and tests share the same command text. `gitEmpty` is derived from the bare repo. First push uses existing post-receive `cloneOrPull`.

**Tech Stack:** TypeScript, Next.js App Router, Drizzle/SQLite, Vitest, existing git-repo helpers.

## Global Constraints

- No host CLI script.
- Add local must not seed README/Forgefile or any commit.
- Recipes must use `cat >> AGENTS.md` (append/create), never `>`.
- Remotes: no origin → `origin`; existing origin → `forge` + `remote.pushDefault forge`.
- Do not `git clone` an empty bare at create time.
- Do not auto-change `projects.branch` from first push.
- Do not commit unless the human asks; skip plan commit steps.
- Run `./test.sh` before finishing; never run Forge `./deploy.sh`.

## File map

- Create: `src/lib/git-local-push-recipes.ts`, `src/lib/git-local-push-recipes.test.ts`
- Create: `src/components/GitLocalPushRecipes.tsx`
- Modify: `src/lib/git-repo.ts`, `src/lib/git-repo.test.ts`
- Modify: `src/lib/git-hook-notify.test.ts`
- Modify: `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/lib/ops-api-project.ts`
- Modify: `src/app/(dashboard)/projects/new/page.tsx`
- Modify: `src/components/ProjectStudio.tsx`
- Modify: `AGENTS.md`, `docs/git-server.md`, `README.md`

---

### Task 1: Push recipes helper

**Files:**
- Create: `src/lib/git-local-push-recipes.ts`
- Test: `src/lib/git-local-push-recipes.test.ts`

**Interfaces:**
- Produces: `forgeLocalAgentsNote()`, `localPushRecipes({ httpsUrl, defaultBranch })` → `{ noOrigin, existingOrigin }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  forgeLocalAgentsNote,
  localPushRecipes,
} from "@/lib/git-local-push-recipes";

describe("localPushRecipes", () => {
  it("uses cat >> AGENTS.md and origin vs forge remotes", () => {
    const recipes = localPushRecipes({
      httpsUrl: "https://forge.example/api/git/demo.git",
      defaultBranch: "main",
    });
    expect(recipes.noOrigin).toContain("git remote add origin https://forge.example/api/git/demo.git");
    expect(recipes.noOrigin).toContain("cat >> AGENTS.md");
    expect(recipes.noOrigin).not.toContain("cat > AGENTS.md");
    expect(recipes.noOrigin).toContain("git push -u origin main");
    expect(recipes.existingOrigin).toContain("git remote add forge https://forge.example/api/git/demo.git");
    expect(recipes.existingOrigin).toContain("git config remote.pushDefault forge");
    expect(recipes.existingOrigin).toContain("cat >> AGENTS.md");
    expect(recipes.existingOrigin).toContain("git push -u forge main");
    expect(forgeLocalAgentsNote()).toContain("Push to Forge");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/git-local-push-recipes.test.ts`

- [ ] **Step 3: Implement helper** with heredoc bodies using `cat >> AGENTS.md << 'EOF'` and `forgeLocalAgentsNote()` contents:

```
## Git remotes (Forge)

Push to Forge by default. If `origin` is this Forge URL, use `git push -u origin <branch>`.
If `origin` still points at GitHub, use the `forge` remote (`git config remote.pushDefault forge`) and do not `git push origin` unless a human asked to update GitHub.
Deploy and agents clone from Forge when this project has a Forge git repository.
```

- [ ] **Step 4: Re-run vitest; expect PASS**

---

### Task 2: Unseeded local git repository

**Files:**
- Modify: `src/lib/git-repo.ts`
- Test: `src/lib/git-repo.test.ts`

**Interfaces:**
- Extends `CreateForgeGitRepositoryOpts` with `seed?: boolean` (default `true`)
- Produces: `bareRepoHasCommits(barePath: string): boolean`

- [ ] **Step 1: Failing tests** in `createForgeGitRepository` describe:

```ts
it("creates an unseeded bare repo for local add without a working clone", async () => {
  const unique = `local-${Date.now()}`;
  const result = await createForgeGitRepository({
    name: unique,
    slug: unique,
    defaultBranch: "main",
    seed: false,
  });
  createdProjectId = result.projectId;
  createdRepoId = result.repositoryId;
  expect(existsSync(result.barePath)).toBe(true);
  expect(existsSync(join(result.barePath, "hooks", "post-receive"))).toBe(true);
  expect(bareRepoHasCommits(result.barePath)).toBe(false);
  expect(existsSync(join(reposRoot, `${unique}-main`))).toBe(false);
  const count = execFileSync("git", ["rev-list", "--all", "--count"], {
    cwd: result.barePath,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
  expect(count).toBe("0");
});
```

- [ ] **Step 2: Run `npx vitest run src/lib/git-repo.test.ts` — fail on seed:false / missing export**

- [ ] **Step 3: Implement** `bareRepoHasCommits` via `git rev-list -n 1 --all`. When `opts.seed === false`, skip seed dir commit/push and skip working `git clone`; still set `clonePath` on the project row.

- [ ] **Step 4: Re-run git-repo tests; expect PASS**

---

### Task 3: First push into unseeded repo

**Files:**
- Test: `src/lib/git-hook-notify.test.ts`

- [ ] **Step 1: Failing test** `processPostReceiveNotify` after `createForgeGitRepository({ seed: false })`, local commit+push, then notify with `enqueueDeploys: false`. Expect working clone file exists and `commitSha` truthy.

- [ ] **Step 2: Run hook tests. If `cloneOrPull` already works, test may pass — do not change cloneOrPull unless it fails.**

- [ ] **Step 3: Fix `cloneOrPull` only if clone of newly pushed branch fails.**

---

### Task 4: API `mode: "local"` and `gitEmpty`

**Files:**
- Modify: `src/app/api/projects/route.ts`
- Modify: `src/app/api/projects/[id]/route.ts`
- Modify: `src/lib/ops-api-project.ts`

POST body `mode?: "create" | "import" | "local"`. `local` requires name, calls `createForgeGitRepository({ ..., seed: false })`. Error text includes `mode=local`. List/detail/ops include `gitEmpty: boolean` (`true` when no git repo or `!bareRepoHasCommits`).

Covered by git-repo tests; API wiring is thin. Add a unit test only if a route test harness already exists; otherwise rely on git-repo + UI.

---

### Task 5: Add local UI + settings recipes

**Files:**
- Create: `src/components/GitLocalPushRecipes.tsx`
- Modify: `src/app/(dashboard)/projects/new/page.tsx`
- Modify: `src/components/ProjectStudio.tsx`

`Mode = "create" | "import" | "local"`. Third button **Add local**. On local success, keep `created` state and render `GitLocalPushRecipes` (no silent redirect). Settings Clone URLs: if `gitEmpty`, show recipes under URLs. Update GitHub-only hint to mention Add local as well as Import GitHub.

---

### Task 6: Docs

**Files:** `AGENTS.md`, `docs/git-server.md`, `README.md`

Document Add local, unseeded repo, origin-vs-forge, `cat >> AGENTS.md`, agents push to Forge by default.

---

### Task 7: Verify

Run `./build.sh --skip-install` then `./test.sh`. Fix failures. Do not run Forge `./deploy.sh`.
