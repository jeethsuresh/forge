# Authenticated MCP Functional Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operators can register named functional users in Global settings and hand each one a remintable `fmu.*` secret that authenticates full Ops (including MCP `tools/call`) on every project.

**Architecture:** Store machine identities in `functional_users` (not `users`). Derive `fmu.<userId>.<mac>` from the existing Ops session secret and a per-row `tokenVersion`. Treat `kind: "functional"` like `kind: "global"` for project scope, bootstrap, lists, and git HTTP. Dashboard cookie APIs mint/rotate/revoke; audit rows name `functional:<name>`.

**Tech Stack:** TypeScript, Drizzle/SQLite, Node `crypto` HMAC, Vitest, Next.js App Router, existing settings UI patterns.

## Global Constraints

- Token format: `fmu.<userId>.<base64url(HMAC-SHA256(opsSessionSecret, "forge-mcp-v1:" + userId + ":" + tokenVersion))>`
- Auth order: missing → `fgc.*` reject → env global → `fmu.*` → `fos.*`
- Privilege: functional == global (all projects, no bootstrap lock)
- No dashboard login for functional users; settings APIs are cookie-only
- `fos.*` and `fgc.*` behavior unchanged
- Never run Forge’s own `./deploy.sh`; verify with `./test.sh`
- Spec: `docs/superpowers/specs/2026-09-27-authenticated-mcp-users-design.md`

## File structure

| File | Responsibility |
|------|----------------|
| `src/lib/db/schema.ts` | `functionalUsers` table + type |
| `src/lib/db/index.ts` | `CREATE TABLE IF NOT EXISTS functional_users` |
| `src/lib/functional-users.ts` | Register, list (with reminted secret), rotate, revoke |
| `src/lib/ops-api-auth.ts` | Mint/parse `fmu.*`; third `OpsAuth` kind |
| `src/lib/ops-api-route.ts` | Treat functional as unrestricted; pass actor into audit |
| `src/lib/ops-api-actions.ts` | Optional `actor` on `recordOpsAction` |
| `src/lib/git-http.ts` | Accept functional tokens like global Ops |
| `src/app/api/settings/functional-users/route.ts` | GET list + POST register |
| `src/app/api/settings/functional-users/[id]/route.ts` | DELETE revoke |
| `src/app/api/settings/functional-users/[id]/regenerate/route.ts` | POST rotate |
| `src/components/FunctionalUsersSettings.tsx` | MCP agents tab UI |
| `src/components/GlobalSettings.tsx` | New tab |
| `src/lib/agent-ops-prompt.ts`, `src/lib/forge-agent/discover.ts`, `src/lib/forge-agent/mcp.ts` | Document `fmu.*` as a Bearer |
| `AGENTS.md`, `docs/git-server.md` | `fmu.*` is Ops, not a clone token |
| Tests listed per task | |

---

### Task 1: Table + token mint/CRUD

**Files:**
- Create: `src/lib/functional-users.ts`
- Create: `src/lib/functional-users.test.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/index.ts`

**Interfaces:**
- Produces:
  - `export type FunctionalUser = { id: string; name: string; tokenVersion: number; createdAt: Date; updatedAt: Date }`
  - `export function mintFunctionalUserToken(userId: string, tokenVersion: number): string`
  - `export function createFunctionalUser(name: string): { user: FunctionalUser; token: string }`
  - `export function listFunctionalUsers(): Array<FunctionalUser & { token: string }>`
  - `export function regenerateFunctionalUserToken(id: string): { user: FunctionalUser; token: string } | null`
  - `export function deleteFunctionalUser(id: string): boolean`
  - Throws `Error` with message starting `Invalid name` or `Name already registered` for 400 mapping

- [ ] **Step 1: Write the failing tests** in `src/lib/functional-users.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { functionalUsers, users } from "@/lib/db/schema";
import {
  createFunctionalUser,
  deleteFunctionalUser,
  listFunctionalUsers,
  mintFunctionalUserToken,
  regenerateFunctionalUserToken,
} from "@/lib/functional-users";

describe("functional users", () => {
  let previousSessionSecret: string | undefined;
  const names: string[] = [];

  beforeEach(() => {
    previousSessionSecret = process.env.FORGE_OPS_SESSION_SECRET;
    process.env.FORGE_OPS_SESSION_SECRET = "test-functional-user-secret";
  });

  afterEach(() => {
    for (const name of names.splice(0)) {
      db.delete(functionalUsers).where(eq(functionalUsers.name, name)).run();
    }
    if (previousSessionSecret === undefined) {
      delete process.env.FORGE_OPS_SESSION_SECRET;
    } else {
      process.env.FORGE_OPS_SESSION_SECRET = previousSessionSecret;
    }
  });

  it("mints stable fmu tokens and remints the same secret", () => {
    const created = createFunctionalUser("claude-desktop");
    names.push("claude-desktop");
    expect(created.token.startsWith(`fmu.${created.user.id}.`)).toBe(true);
    expect(mintFunctionalUserToken(created.user.id, created.user.tokenVersion)).toBe(
      created.token,
    );
    expect(listFunctionalUsers()[0]?.token).toBe(created.token);
  });

  it("rotates by bumping tokenVersion and invalidates the old secret", () => {
    const created = createFunctionalUser("cursor-mcp");
    names.push("cursor-mcp");
    const old = created.token;
    const rotated = regenerateFunctionalUserToken(created.user.id);
    expect(rotated?.user.tokenVersion).toBe(2);
    expect(rotated?.token).not.toBe(old);
    expect(mintFunctionalUserToken(created.user.id, 1)).toBe(old);
  });

  it("rejects empty and duplicate names and does not create dashboard users", () => {
    expect(() => createFunctionalUser("  ")).toThrow(/Invalid name/);
    const created = createFunctionalUser("shared-name");
    names.push("shared-name");
    expect(() => createFunctionalUser("shared-name")).toThrow(/already registered/);
    expect(
      db.select().from(users).all().some((row) => row.username === "shared-name"),
    ).toBe(false);
  });

  it("delete removes the row so remint cannot succeed from a leftover version", () => {
    const created = createFunctionalUser("to-revoke");
    expect(deleteFunctionalUser(created.user.id)).toBe(true);
    expect(listFunctionalUsers().some((row) => row.id === created.user.id)).toBe(false);
    expect(deleteFunctionalUser(created.user.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/functional-users.test.ts`
Expected: FAIL (module or table missing)

- [ ] **Step 3: Implement schema, INIT_SQL, and lib**

`functional_users` columns: `id`, `name` unique, `token_version` integer not null default 1, `created_at`, `updated_at`.

HMAC uses `resolveOpsSessionSecret()` from `@/lib/ops-api-auth`. Name: trim, 1–80 chars, unique.

- [ ] **Step 4: Re-run tests**

Expected: PASS

---

### Task 2: Authenticate `fmu.*` as unrestricted Ops

**Files:**
- Modify: `src/lib/ops-api-auth.ts`
- Modify: `src/lib/ops-api-route.ts`
- Modify: `src/lib/ops-api-actions.ts`
- Modify: `src/lib/ops-api.test.ts`
- Modify: `src/lib/ops-bootstrap-guard.ts` only if needed (`kind !== "session"` already allows functional)

**Interfaces:**
- Extends `OpsAuth` with `{ kind: "functional"; userId: string; name: string }`
- `denyIfWrongProject` returns null for `global` and `functional`
- `recordOpsAction` accepts optional `actor?: string` (default `"agent"`)
- `auditOpsAction` sets `actor` to `functional:<name>` / `global` / `agent` and leaves `agentSessionId` null for functional

- [ ] **Step 1: Add failing auth + audit tests** to `src/lib/ops-api.test.ts`

Cover: valid `fmu.*` → functional; rotated secret → null; deleted row → null; `fgc.*` still null; `fos.*` unchanged; `denyIfWrongProject(functional, otherProject)` is null; `denyIfBootstrapRestricted(functional, deployUrl)` is null; `recordOpsAction({ actor: "functional:claude-desktop" })` persists that actor; `auditOpsAction` with functional auth writes `functional:<name>`.

- [ ] **Step 2: Run the new tests — expect FAIL**
- [ ] **Step 3: Implement auth order, privilege, and actor**
- [ ] **Step 4: Re-run — expect PASS**

---

### Task 3: Git HTTP + MCP `tools/call`

**Files:**
- Modify: `src/lib/git-http.ts` (treat `functional` like `global`; actor `ops-global`)
- Modify: `src/lib/git-http.test.ts`
- Modify: `src/lib/forge-agent/mcp.test.ts`
- Modify: `src/lib/forge-agent/mcp.ts` (initialize / 401 hint mention `fmu.*`)

- [ ] **Step 1: Failing tests** — git HTTP accepts Bearer `fmu.*`; MCP `tools/call` with `fmu.*` is not 401; rotated `fmu.*` is 401; initialize instructions mention `fmu.`
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement git-http branch + MCP copy**
- [ ] **Step 4: Re-run — expect PASS**

---

### Task 4: Settings APIs + Global settings tab

**Files:**
- Create: `src/app/api/settings/functional-users/route.ts`
- Create: `src/app/api/settings/functional-users/[id]/route.ts`
- Create: `src/app/api/settings/functional-users/[id]/regenerate/route.ts`
- Create: `src/lib/functional-users-routes.test.ts` (401 without cookie; 400 duplicate via lib already covered)
- Create: `src/components/FunctionalUsersSettings.tsx`
- Modify: `src/components/GlobalSettings.tsx`
- Modify: `e2e/settings.spec.ts`

Cookie auth copies `git-ssh-keys/route.ts` `requireLogin`. UI copies `GitSshKeysSettings` + `GitHttpsCredentials` copy/confirm pattern. Tab label **MCP agents**. Subtitle mentions functional users / full Ops. List shows reminted token, Copy, Regenerate (confirm), Revoke.

- [ ] **Step 1: Failing route tests** — GET/POST/DELETE/regenerate without login → 401
- [ ] **Step 2: Implement routes + UI + e2e tab assertion**
- [ ] **Step 3: Re-run unit tests**

---

### Task 5: Docs / discovery copy

**Files:**
- Modify: `src/lib/agent-ops-prompt.ts` (`auth.sessionTokens` mentions `fmu.*`)
- Modify: `src/lib/forge-agent/discover.ts` (`auth.howTo`)
- Modify: `src/lib/ops-api.test.ts` (catalog mentions `fmu.`)
- Modify: `AGENTS.md`
- Modify: `docs/git-server.md`
- Modify: `src/lib/git-https-auth.ts` / test if help text should mention functional secrets

- [ ] Update copy; extend existing catalog/discover tests to expect `fmu.`
- [ ] Run `./test.sh`

---

### Task 6: Ship

- [ ] Commit on `agent/authenticated-mcp`
- [ ] Merge into `main` (no force-push)
- [ ] Redeploy Forge via `POST /api/ops/projects/{id}/deploy` (never `./deploy.sh`)
