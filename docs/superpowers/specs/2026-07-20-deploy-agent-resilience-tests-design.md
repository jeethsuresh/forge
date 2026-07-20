# Deploy / agent resilience integration tests (design)

Date: 2026-07-20  
Status: implemented

## Problem

Forge repeatedly hits the same failure classes around deploys and agents:

1. **Buildx-masked daemon death** — unreachable Docker/Podman (`DOCKER_HOST`) surfaces as a BuildKit/buildx deprecation warning instead of a clear runtime error.
2. **`.git/FETCH_HEAD` inaccessible** — updater sidecar `chown node:node` under `FORGE_RUN_AS_ROOT=1` leaves keep-id agents unable to write FETCH_HEAD.
3. **False “Agent session interrupted”** — reconciliation marks finished or mid-self-deploy sessions interrupted after process/map loss.
4. **Weird self-deploy failures** — Podman socket/TCP, staging cutover, and agent-driven forge deploys that take the wrong path (`./deploy.sh` / generic `runDeployment` instead of `startForgeUpdate`).

Unit tests cover pieces in isolation. Shell (`self-update.sh`, `common.sh`, `build.sh`) is barely exercised. Live Redeploy / agent-cutover is not gated.

## Goals

1. Fail `./test.sh` when any of the four invariants regress (Layers A + B always).
2. Provide a **live cutover suite** that actually Redeploys Forge via Ops (or deploys an agent-created forge commit) and fails if logs/outcomes show those error classes.
3. Live suite is **opt-in for humans**; **always enabled when an agent runs the tests**.
4. Never invoke Forge’s own `./deploy.sh` from the suite (Ops / `startForgeUpdate` only).
5. Never nest a live cutover inside the self-updater’s own `./test.sh` stage.

## Non-goals

- Replacing existing unit tests.
- Running live cutover on every local human `./test.sh`.
- Browser UI automation as the primary forge (API/harness only).

## Layers

### Layer A — cross-module vitest (always on)

**File:** `src/lib/deploy-agent-resilience.integration.test.ts`

Real in-memory SQLite + temp dirs + mocked `child_process` / docker helpers (same style as `ops-api.test.ts` / `self-update.test.ts`).

| Case | Must fail if |
|------|----------------|
| Daemon / buildx | Dead `DOCKER_HOST` → `ensureDockerDaemon()` rejects with actionable “Cannot connect to container runtime…”; primary message must not be a bare buildx deprecation string |
| FETCH_HEAD (TS) | Unwritable `.git` → `ensureForgeSourceWritableForAgents()` issues `docker run … chown -R 0:0`; still unwritable → throws explicit FETCH_HEAD Permission denied text |
| False interrupt | Wipe in-memory process maps (simulated restart); completed turns and same-deployment `deploying` sessions stay non-interrupted; truly stale sessions fail with the expected message |
| Self-deploy reconcile | Orphaned in-progress forge update + success marker / matching release-state → healed to success; abandoned deploying without match → clear failure, not a vague interrupt |
| Forge agent deploy path | `deployAfterAgent` / forge-project deploy must call **`startForgeUpdate`**, not generic `runDeployment` / `./deploy.sh` (regression for “weird self-deploy” when an agent finishes on Forge) |

### Layer B — script harness (always on)

**Dir:** `scripts/test/harness/` — stub binaries on `PATH` + temp `SOURCE_DIR` / env. Invoked from vitest or a thin runner wired into `./test.sh`.

| Case | Must fail if |
|------|----------------|
| `common.sh` socket | TCP API “ready” but bind-mounted socket fails `-S` → `resolve_docker_socket` still returns configured host path (updater-sidecar mode) |
| `self-update.sh` perms | `FORGE_RUN_AS_ROOT=1` → `normalize_source_permissions` chowns `root:root` (not `node:node`); recovery path calls normalize before agent git fetch |
| Build preflight | Compose build path does not proceed when runtime probe fails (harness-recorded exit / log) |

No real compose stack; no Forge `./deploy.sh`.

### Layer C — live smoke + cutover (conditional)

**Files:** e.g. `src/lib/forge-live-smoke.integration.test.ts` and/or `scripts/test/live-forge-smoke.mjs`

#### Enablement

| Context | Live suite |
|---------|------------|
| Default human `./test.sh` | Off (A+B only) |
| `./test.sh --live-smoke` or `FORGE_LIVE_SMOKE=1` | On |
| `FORGE_LIVE_SMOKE=0` | Force off |
| **Agent context** (`FORGE_OPS_API_TOKEN` matches `^fos\.` and `FORGE_OPS_API_BASE` set) | **On automatically** |
| Self-update test stage (`scripts/self-update.sh` runs `./test.sh` with staging project / updater env) | **Always off** — detect via updater/staging env (e.g. updater id / staging compose project) so cutover never nests |

Document in `test.sh --help` and `AGENTS.md`: agents running Forge tests get the full suite; humans must pass `--live-smoke` for cutover.

#### C1 — non-cutover probes (when live on)

- `GET /api/forge/health` (or status) OK.
- Runtime: Forge’s configured `DOCKER_HOST` / `docker info` succeeds (guards buildx-masked daemon death).
- Inside app container: forge-source `.git` writability probe (FETCH_HEAD class).

#### C2 — same-SHA Redeploy Forge (when live on)

1. Resolve Forge project id via Ops.
2. `POST /api/ops/projects/{id}/deploy` with `actionDescription` documenting live smoke (triggers `startForgeUpdate`, never `./deploy.sh`).
3. Poll until terminal status.
4. **Fail** if status ≠ success, or logs match forbidden patterns:
   - buildx / “Install the buildx component” as the effective failure
   - `FETCH_HEAD` / Permission denied on `.git`
   - false “Agent session interrupted” on sessions that should survive cutover
5. Re-auth note: cutover invalidates cookie sessions; Ops token / status poll must survive (Bearer ops token, not browser cookie).

#### C3 — deploy a forge commit created by an agent (when live on)

Two complementary checks:

1. **Harness commit + Ops cutover (default live path)**  
   - Create throwaway branch `forge-smoke/<timestamp>` in forge-source with a trivial marker commit (simulates agent commit without requiring a second Cursor agent).  
   - Ops deploy that branch via self-update.  
   - Assert success + same forbidden-pattern checks as C2.  
   - Clean up: leave branch local-only or delete if safe; do not push to GitHub unless already required by self-update fetch rules (prefer local branch that self-update can use from `/data/forge-source`).

2. **True agent finish path (Layer A mandatory + live when affordable)**  
   - Layer A already asserts forge `deployAfterAgent` → `startForgeUpdate`.  
   - Live optional extension: start a **dedicated** Ops smoke agent session on `forge-smoke/…` whose only job is a no-op or marker edit, then finish/deploy; assert session is not falsely interrupted and update succeeds. Skip spawning a second Cursor agent if CLI/API key unavailable — do not skip C3.1.

#### Self-blocking: agent mid-turn on Forge

Today Ops deploy returns **409** while any `pending|running|deploying` session exists on the project. An agent that auto-runs the full suite mid-turn would otherwise never execute C2/C3.

**Product tweak (in scope for this work):**

- Extend Ops `POST …/deploy` for forge projects to accept:
  - `authorizeActiveSessionDeploy: true`
  - Allowed only when auth is a **session token** (`fos.<sessionId>.…`) for that same project and the blocking active session id equals that session id.
- Behavior: treat as agent-authorized self-deploy — transition that session to `deploying` (or equivalent), call `startForgeUpdate`, wait/finalize with existing deployment-outcome guards (same invariants as `finishAgentSession`, but using self-update rather than generic `runDeployment`).
- Global-token callers do **not** get a blanket bypass; they still require no other blocking session (or only run C2/C3 when idle).
- Humans with `--live-smoke` and global token: run when forge has no blocking agent; otherwise fail with a clear “end agent sessions first” message.

This is what makes “when an agent runs tests, run all the tests” real without nesting updater `./test.sh` cutovers.

## Wiring

- Extend `./test.sh` with `--live-smoke`; export `FORGE_LIVE_SMOKE=1`.
- Vitest: live files gated by env (e.g. `describe.skipIf(!process.env.FORGE_LIVE_SMOKE)`).
- Auto-set `FORGE_LIVE_SMOKE=1` in `test.sh` when agent context detected and not force-off / not updater stage.
- `./test.sh` remains the gate for A+B; agents get A+B+C.
- No orphan containers from harness stubs; live cutover uses existing forge stack only.
- Add unit tests for the new Ops `authorizeActiveSessionDeploy` behavior.

## Success criteria

- Regression on any of the four classes fails Layer A and/or B without needing a live Forge.
- With live on, a broken daemon, FETCH_HEAD ownership, false interrupt after cutover, or failed/misrouted self-deploy fails the suite.
- Agent-run `./test.sh` exercises cutover via session-authorized Ops deploy.
- Self-update’s internal `./test.sh` never triggers Layer C.

## Spec self-review

- No TBD placeholders for enablement or C2/C3 paths.
- Nested updater cutover explicitly forbidden.
- Scope is one suite + one small Ops authorization extension; no unrelated refactors.
