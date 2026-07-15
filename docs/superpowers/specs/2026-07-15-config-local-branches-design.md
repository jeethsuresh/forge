# Config tab: local branch management + collapsible Caddy

## Goals
- From project Config & history: rename and delete **local** branches.
- Make Host/port & Caddy and Caddy access logs independently collapsible (default collapsed, remembered per project).

## Delete
1. Confirm → `git branch -d`.
2. If not fully merged → API `409` with `code: "NOT_FULLY_MERGED"` → second confirm → `git branch -D` (`force: true`).

## Rename
- Confirm → `git branch -m <old> <new>` with `validateBranchName` on both.
- Target name must not already exist.

## Guards (409 / 400)
- Project-wide: active agent session or in-progress deploy (`branchOpsBlockedResponse`).
- Cannot delete/rename currently checked-out branch.
- Cannot delete/rename project watch/deploy branch (`projects.branch`).
- Local only (never remote refs).

## API
`GET|PATCH|DELETE /api/projects/[id]/local-branches`
- GET: `{ branches, currentBranch, watchBranch }`
- DELETE body: `{ branch, force? }`
- PATCH body: `{ branch, newName }`
Invalidate `project-branches-cache` on success.

## UI
- `ProjectLocalBranchesEditor` on Config tab after Project rename.
- Collapsible headers on `ProjectRoutingEditor` and `ProjectCaddyLogsSection`; `localStorage` keys per project.

## Out of scope
- Remote branch delete/rename; checkout UI; force-push.
