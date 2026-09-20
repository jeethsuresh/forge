# Per-branch Changes editor

**Date:** 2026-09-20  
**Status:** Approved for implementation  
**Related:** Changes tab (`ProjectDiffPanel`), agent containers, git tree merge/rebase, local branch delete

## Goal

Turn `/projects/[id]/changes` into a **per-branch code editor**: pick any branch, see **all files** on that branch (changed files highlighted vs the watch branch), edit in Monaco, and **commit + push** from that tab. Each branch has its own checkout in a sticky minimal container that **agents on that branch share**. Containers are **killed and recreated on merge** (and destroyed on branch delete).

## Decisions

| Topic | Choice |
|-------|--------|
| Isolation | Approach A: host clone per branch + `forge-branch` container bind-mount |
| Agent sharing | Same checkout (`workspaceBind`). Exclusive writer: pause `forge-branch` while `forge-agent` runs, then resume |
| Lifecycle | Sticky once created (editor open or agent start) until merge or branch delete. Not idle-stopped. Not pre-created for every local branch |
| File I/O | Forge Node APIs read/write the host workspace path (not `docker exec`) |
| Changed files | Union of dirty working-tree paths and `git diff --name-status <merge-base(watch,HEAD)>..HEAD` |
| Commit | `git add -A` in that workspace, commit, **push to Forge git** |
| Old diff modes | Removed from Changes. Merge/rebase stay on Deploy git tree |
| Forge self-project | Editor/agent use a branch workspace, **never** live `clonePath` / `/data/forge-source` |
| `clonePath` | Remains fetch/graph/deploy mirror. Agents and Changes do not `git checkout` it |

## Product

Header: branch `<select>` (same names as today’s branch lists). Opening a branch calls `ensureBranchWorkspace`. Container status is a short sentence (running / paused for agent / missing).

Left: full file tree. Filter **Changed only**. Status marks `M` / `A` / `D` / `U` (untracked). Deleted paths still listed.

Center: existing Monaco (`ProjectDiffEditor`). Any non-binary file is editable, including unchanged files. Save + Cmd/Ctrl+S. Diff decorations vs merge-base with watch (working tree included).

Edge: commit message + **Commit**. Default message: `Manual commit from Changes tab`. Pushes to Forge remote.

URL: `?branch=` + `?file=`. `?session=` jumps to that session’s branch. Drop Uncommitted / Branch vs watch / Range / Rebase preview / Merge preview chips.

## Data

Table `branch_workspaces`:

- `id` TEXT PK
- `project_id` TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
- `branch` TEXT NOT NULL
- `workspace_path` TEXT NOT NULL
- `container_name` TEXT NOT NULL
- `status` TEXT NOT NULL (`running` \| `paused` \| `stopped`)
- `created_at` INTEGER NOT NULL

Unique `(project_id, branch)`.

Path: `{FORGE_BRANCH_WORKSPACES_DIR or dirname(FORGE_DB_PATH)/branch-workspaces}/<projectId>/<slug(branch)>/`.  
Slug: lowercase, non-alphanumeric → hyphen, max 48 chars, plus 8-char sha256 of the original branch name (collision-safe). `:memory:` DB uses `/tmp/forge-branch-workspaces-test`.

Container name: `forge-branch-<first 12 of projectId>-<12-char sha256 of branch>`.

## Container

Image `forge-branch:latest` (`FORGE_BRANCH_IMAGE` override), built from `docker/branch/` in `build.sh` beside `forge-agent`. Alpine + git + ca-certificates. `CMD sleep infinity`. `--user 0:0`, `--network host`, bind `workspacePath:/workspace/repo:z`. **No docker.sock.** Labels `forge.branch.project` + `forge.branch.ref`.

Ensure: clone from `projectRemoteUrl` if the directory is missing, checkout the branch (materialize `origin/<branch>` like `ensureLocalBranchForAgent`), start/reuse the named container, upsert the row.

Destroy: `docker rm -f`, delete directory, delete row.

Pause: `docker stop` before agent bind; status `paused`.  
Resume: `docker start` after agent container is gone if the row still exists; status `running`.

Merge (any git-tree merge or rebase finalize) or rebase: **destroy all** `branch_workspaces` for that project. Recreate lazily on next editor/agent use.

Local branch delete: destroy that branch’s workspace. Rename: destroy the old name’s workspace.

## APIs

Dashboard session auth.

- `GET /api/projects/[id]/branch-editor?branch=`  
  Optional `session` to resolve branch. Missing `branch` defaults to watch branch.  
  Response: `{ branch, watchBranch, branches, files: [{ path, status }], dirty, containerStatus, sessionId, sessionBranch }`  
  Ensures the workspace as a side effect.

- `GET /api/projects/[id]/branch-editor/file?branch=&path=`  
  `{ file: ProjectGitFileResult }` with `editable: true` unless binary/deleted.

- `PUT /api/projects/[id]/branch-editor/file` `{ branch, path, content }`

- `POST /api/projects/[id]/branch-editor/commit` `{ branch, message? }`  
  `{ committed, pushed, commitSha }` — commit + push from the **workspace path**.

Keep existing `/diff*` routes for leftover callers/tests; Changes UI does not use them.

## Agents

`runAgentTurnContainer` / `commitAgentSessionChanges` / revert / `prepareAgentWorkspace` callers that edit files use `ensureBranchWorkspace(project, session.branch).workspacePath` instead of `project.clonePath`.

Do not `git checkout` `clonePath` for agent or editor.

Integration invariant tests that only grep `ensureLocalBranchForAgent` must also accept branch-workspace ensure.

## UI files

- `ProjectBranchEditor.tsx` — shell (picker, commit, status)
- `ProjectBranchFileTree.tsx` — tree + changed filter
- Keep `ProjectDiffEditor.tsx`
- `ProjectStudio.tsx` swaps `ProjectDiffPanel` → `ProjectBranchEditor` only
- Remove Changes usage of `ProjectDiffPanel` (delete the panel if unused)
- 1k-line rule: do not grow `ProjectStudio` / `AgentWorkspace` / `agent-container.ts`

URL helpers: `buildProjectDiffHref` still targets `/changes`; session and branch helpers use `session` / `branch` without `mode=`.

## Tests

- Slug/path safety; unique slug for `feat/foo` vs `feat-foo`
- Ensure clones + checkouts the requested branch; second ensure is idempotent
- Destroy removes dir + row; merge/delete hooks call destroy
- Pause/resume docker args (mocked runner); agent start pause-then-run order
- Tree: HEAD files + dirty + vs-watch union; deleted paths included
- File read/write/commit uses workspace path, not `clonePath`; commit pushes
- `assertSafeRepoRelativePath` still rejects `..`
- e2e: heading Changes, branch picker, no Uncommitted chip

## Out of scope

Per-file staging, commit-on-save, CodeMirror, in-editor merge conflicts, language servers in `forge-branch`, always-on containers for unopened branches, Ops catalog endpoints for the editor.
