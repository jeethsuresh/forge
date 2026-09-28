# Container logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist compose container logs (including failed starts) for the Forge UI and Ops agents, and make Up/Down badges follow live container runtime.

**Architecture:** SQLite `container_logs` snapshots keyed by project + container name; collect via `docker logs` + inspect; observe runtime independently of published ports and HTTP probes; surface logs through dashboard/Ops GET and expandable container rows.

**Tech Stack:** TypeScript, Vitest, Drizzle/SQLite, existing docker helpers, Next App Router, Ops catalog/registry.

## Global Constraints

- Never run Forge `./deploy.sh`; redeploy via Ops API after `./test.sh` passes
- Secret redaction matches agent container logs
- Health probes do not force Down while a container is running
- One latest log snapshot per container name (no version history)

---

### Task 1: Runtime helpers + observation

**Files:**
- Create: `src/lib/container-runtime.ts`, `src/lib/container-runtime.test.ts`
- Modify: `src/lib/service-observe.ts`, `src/lib/service-observe.test.ts`, `src/lib/project-status.ts`, `src/lib/docker.ts` (`formatPorts` string Ports)

- [ ] Running + empty ports → status `up`
- [ ] Health 503 does not Down a running target (Task 2)
- [ ] Capitalized Up/Down used by UI later

### Task 2: Health tick respects runtime

**Files:** `src/lib/service-health.ts`, `src/lib/service-health.test.ts`

- [ ] Failed probe writes `lastError`, keeps `up` when runtime is up
- [ ] Tick refreshes runtime from compose ps before probes

### Task 3: Persist container logs

**Files:** schema + `src/lib/container-logs.ts` + tests

- [ ] Upsert, redact, inspect-error fallback, cap

### Task 4: Capture on deploy + APIs + UI

**Files:** deployer, ops/dashboard routes, catalog, registry, `ProjectContainers.tsx`

- [ ] GET ops + dashboard; expandable logs; badges Up/Down
