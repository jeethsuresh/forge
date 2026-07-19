# Per-session Ops API tokens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every non-archived agent session always gets a project-scoped HMAC Ops token in env, so agents can call `/api/ops/*` without a global `FORGE_OPS_API_TOKEN` and never see the “not configured” warning.

**Architecture:** Derive `fos.<sessionId>.<mac>` via HMAC-SHA256 over a server secret (`FORGE_OPS_SESSION_SECRET` or persisted beside the DB). Dual auth: optional global token (full access) or session token (project-scoped). Inject the session token on every agent spawn; update `requireOpsAuth` to return auth kind and enforce project scope on routes.

**Tech Stack:** TypeScript, Node `crypto`, Vitest, existing `ops-api-*` / `agent-runner` modules, Next.js App Router ops routes.

## Global Constraints

- Token format: `fos.<sessionId>.<base64url(HMAC-SHA256(secret, "forge-ops-v1:" + sessionId + ":" + projectId))>`
- Revoke signal: `agent_sessions.archived_at IS NOT NULL` — status alone does not revoke
- Agents always use session token in `FORGE_OPS_API_TOKEN` (never inherit global)
- Optional global `FORGE_OPS_API_TOKEN` remains for CI/curl (full access)
- No WARNING string in agent ops prompt
- Never run Forge’s own `./deploy.sh`; verify with `./build.sh --skip-install` and `./test.sh` before finishing
- Spec: `docs/superpowers/specs/2026-07-19-per-session-ops-tokens-design.md`

## File structure

| File | Responsibility |
|------|----------------|
| `src/lib/ops-api-auth.ts` | Secret resolve, mint session token, parse/verify dual auth → `OpsAuth` |
| `src/lib/ops-api-route.ts` | `requireOpsAuth` → `OpsAuth \| NextResponse`; project-scope helper; audit session id from token |
| `src/lib/agent-ops-prompt.ts` | Prompt + catalog text (no WARNING; document dual auth / scope) |
| `src/lib/agent-runner.ts` | Always inject minted session token |
| `src/app/api/ops/**/route.ts` | Use new auth result + project scope / filtered lists |
| `src/lib/ops-api.test.ts` | Unit tests for mint/verify/scope/prompt |
| `.env.example`, `AGENTS.md`, `docker-compose.yml` | Document optional secrets |

---

### Task 1: Ops session token mint + verify (lib)

**Files:**
- Modify: `src/lib/ops-api-auth.ts`
- Modify: `src/lib/ops-api.test.ts`

**Interfaces:**
- Produces:
  - `export type OpsAuth = { kind: "global" } | { kind: "session"; sessionId: string; projectId: string }`
  - `export function resolveOpsSessionSecret(): string`
  - `export function mintSessionOpsToken(sessionId: string, projectId: string): string`
  - `export function authenticateOpsRequest(request: Request): OpsAuth | null`
  - `export function isOpsApiConfigured(): boolean` — true if global token set **or** session secret resolvable
  - Keep `opsApiBaseUrl()` unchanged
  - Deprecate/remove boolean-only `verifyOpsApiToken` or keep as thin wrapper for global-only tests

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ops-api.test.ts` (preserve env restore for `FORGE_OPS_API_TOKEN`, `FORGE_OPS_API_BASE`, `PORT`; also save/restore `FORGE_OPS_SESSION_SECRET` and any secret-file env you introduce):

```ts
import {
  authenticateOpsRequest,
  isOpsApiConfigured,
  mintSessionOpsToken,
  // ...
} from "@/lib/ops-api-auth";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { randomUUID } from "crypto";

// inside describe("ops-api-auth"):
it("is configured when session secret exists even without global token", () => {
  delete process.env.FORGE_OPS_API_TOKEN;
  process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
  expect(isOpsApiConfigured()).toBe(true);
});

it("mints stable fos tokens and authenticates them for live sessions", () => {
  process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
  delete process.env.FORGE_OPS_API_TOKEN;

  const projectId = randomUUID();
  const sessionId = randomUUID();
  db.insert(projects)
    .values({
      id: projectId,
      name: "Ops Token Project",
      repoUrl: "https://example.com/repo.git",
      clonePath: "/tmp/ops-token-project",
      watchBranch: "main",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId,
      branch: "main",
      status: "running",
      initialPrompt: "test",
      source: "manual",
      logs: "",
      startedAt: new Date(),
    })
    .run();

  const token = mintSessionOpsToken(sessionId, projectId);
  expect(token.startsWith(`fos.${sessionId}.`)).toBe(true);
  expect(mintSessionOpsToken(sessionId, projectId)).toBe(token);

  const auth = authenticateOpsRequest(
    new Request("http://localhost", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  expect(auth).toEqual({
    kind: "session",
    sessionId,
    projectId,
  });
});

it("rejects session tokens for archived sessions", () => {
  process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
  // insert project + session with archivedAt: new Date()
  // mint token, authenticateOpsRequest → null
});

it("still accepts global bearer token", () => {
  process.env.FORGE_OPS_API_TOKEN = "global-secret";
  process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
  const auth = authenticateOpsRequest(
    new Request("http://localhost", {
      headers: { authorization: "Bearer global-secret" },
    }),
  );
  expect(auth).toEqual({ kind: "global" });
});
```

Use the same `projects` / `agentSessions` column set other tests use (`src/lib/agent-state.test.ts` as reference for required fields).

- [ ] **Step 2: Run tests to verify they fail**

Run: `./test.sh` (or vitest filter `ops-api` if the script supports it — prefer full `./test.sh` when unsure)

Expected: FAIL — `mintSessionOpsToken` / `authenticateOpsRequest` not exported or auth still global-only.

- [ ] **Step 3: Implement `ops-api-auth.ts`**

```ts
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";

export type OpsAuth =
  | { kind: "global" }
  | { kind: "session"; sessionId: string; projectId: string };

const MAC_PAYLOAD_PREFIX = "forge-ops-v1:";

function opsSessionSecretPath(): string {
  if (process.env.FORGE_OPS_SESSION_SECRET_FILE?.trim()) {
    return process.env.FORGE_OPS_SESSION_SECRET_FILE.trim();
  }
  const dbPath = process.env.FORGE_DB_PATH ?? "./data/forge.db";
  if (dbPath === ":memory:") {
    return join("/tmp", "forge-ops-session-secret-test");
  }
  return join(dirname(dbPath), "forge-ops-session-secret");
}

let memorySecret: string | null = null;

export function resolveOpsSessionSecret(): string {
  const fromEnv = process.env.FORGE_OPS_SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.FORGE_DB_PATH === ":memory:") {
    if (!memorySecret) memorySecret = randomBytes(32).toString("hex");
    return memorySecret;
  }

  const path = opsSessionSecretPath();
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  }
  const generated = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generated, { mode: 0o600 });
  return generated;
}

export function mintSessionOpsToken(sessionId: string, projectId: string): string {
  const secret = resolveOpsSessionSecret();
  const mac = createHmac("sha256", secret)
    .update(`${MAC_PAYLOAD_PREFIX}${sessionId}:${projectId}`)
    .digest("base64url");
  return `fos.${sessionId}.${mac}`;
}

function parseSessionOpsToken(token: string): { sessionId: string; mac: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "fos") return null;
  const [, sessionId, mac] = parts;
  if (!sessionId || !mac) return null;
  return { sessionId, mac };
}

function macEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function authenticateOpsRequest(request: Request): OpsAuth | null {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const headerToken = request.headers.get("x-forge-ops-token");
  const presented = (bearer ?? headerToken)?.trim() || null;
  if (!presented) return null;

  const global = process.env.FORGE_OPS_API_TOKEN?.trim();
  if (global && presented === global) {
    return { kind: "global" };
  }

  const parsed = parseSessionOpsToken(presented);
  if (!parsed) return null;

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, parsed.sessionId))
    .get();
  if (!session || session.archivedAt) return null;

  const expected = mintSessionOpsToken(session.id, session.projectId);
  const expectedParsed = parseSessionOpsToken(expected);
  if (!expectedParsed || !macEqual(parsed.mac, expectedParsed.mac)) return null;

  return {
    kind: "session",
    sessionId: session.id,
    projectId: session.projectId,
  };
}

export function isOpsApiConfigured(): boolean {
  if (process.env.FORGE_OPS_API_TOKEN?.trim()) return true;
  try {
    return Boolean(resolveOpsSessionSecret());
  } catch {
    return false;
  }
}

// Remove or adapt old verifyOpsApiToken to call authenticateOpsRequest !== null
```

Adapt insert helpers in tests to match real schema nullability (`enabled`, timestamps, etc.).

- [ ] **Step 4: Run tests to verify they pass**

Run: `./test.sh`  
Expected: PASS for new ops-api-auth cases (fix unrelated failures before proceeding).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ops-api-auth.ts src/lib/ops-api.test.ts
git commit -m "$(cat <<'EOF'
Add HMAC session Ops API token minting and dual auth.

EOF
)"
```

---

### Task 2: Route helpers — auth result + project scope

**Files:**
- Modify: `src/lib/ops-api-route.ts`
- Modify: `src/lib/ops-api.test.ts` (optional helper unit tests)
- Modify: every `src/app/api/ops/**/route.ts` that calls `requireOpsAuth`

**Interfaces:**
- Consumes: `authenticateOpsRequest`, `isOpsApiConfigured`, `OpsAuth` from Task 1
- Produces:
  - `requireOpsAuth(request): OpsAuth | NextResponse`
  - `denyIfWrongProject(auth: OpsAuth, projectId: string): NextResponse | null`
  - `resolveOpsActorSessionId(auth: OpsAuth, request: Request): string | null`

- [ ] **Step 1: Update `ops-api-route.ts`**

```ts
import { NextResponse } from "next/server";
import {
  authenticateOpsRequest,
  isOpsApiConfigured,
  type OpsAuth,
} from "@/lib/ops-api-auth";

export function requireOpsAuth(request: Request): OpsAuth | NextResponse {
  if (!isOpsApiConfigured()) {
    return NextResponse.json(
      { error: "Forge Ops API is not configured" },
      { status: 503 },
    );
  }
  const auth = authenticateOpsRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return auth;
}

export function denyIfWrongProject(
  auth: OpsAuth,
  projectId: string,
): NextResponse | null {
  if (auth.kind === "global") return null;
  if (auth.projectId === projectId) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function resolveOpsActorSessionId(
  auth: OpsAuth,
  request: Request,
): string | null {
  if (auth.kind === "session") return auth.sessionId;
  return request.headers.get("x-forge-agent-session-id")?.trim() || null;
}
```

Update `auditOpsAction` / `jsonWithAudit` callers to pass session id from `resolveOpsActorSessionId` when auth is available. Minimal approach: change `readAgentSessionHeader` usage in `auditOpsAction` to accept optional override, or thread `auth` into `auditOpsAction`.

Simplest reliable pattern for project routes:

```ts
const auth = requireOpsAuth(request);
if (auth instanceof NextResponse) return auth;
const forbidden = denyIfWrongProject(auth, id);
if (forbidden) return forbidden;
```

For catalog `GET /api/ops`: only `requireOpsAuth`, no project check.

- [ ] **Step 2: Update all ops routes**

Touch each file under `src/app/api/ops/` that currently does:

```ts
const authError = requireOpsAuth(request);
if (authError) return authError;
```

Replace with auth result + `denyIfWrongProject` when the route has a `{id}` project param.

Special cases:

**`src/app/api/ops/projects/route.ts` (list):**

```ts
const auth = requireOpsAuth(request);
if (auth instanceof NextResponse) return auth;

const allProjects = db.select().from(projects).orderBy(projects.name).all();
const scoped =
  auth.kind === "session"
    ? allProjects.filter((p) => p.id === auth.projectId)
    : allProjects;
const summaries = await Promise.all(scoped.map(buildOpsProjectSummary));
return NextResponse.json({ projects: summaries });
```

**`src/app/api/ops/actions/route.ts`:**

Filter `listRecentOpsActions` results (or add optional `projectId` / `agentSessionId` args to `listRecentOpsActions`) so session auth only sees matching rows.

- [ ] **Step 3: Fix TypeScript compile**

Run: `./build.sh --skip-install`  
Expected: PASS (all `instanceof NextResponse` / unused auth vars cleaned up).

- [ ] **Step 4: Run tests**

Run: `./test.sh`  
Expected: PASS. Update any tests that assumed boolean `verifyOpsApiToken` / old 503 copy.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ops-api-route.ts src/app/api/ops src/lib/ops-api.test.ts src/lib/ops-api-actions.ts
git commit -m "$(cat <<'EOF'
Scope Ops API routes for session vs global auth.

EOF
)"
```

---

### Task 3: Agent env injection + prompt (no WARNING)

**Files:**
- Modify: `src/lib/agent-runner.ts` (env block ~623–626)
- Modify: `src/lib/agent-ops-prompt.ts`
- Modify: `src/lib/ops-api.test.ts` (prompt assertions)

**Interfaces:**
- Consumes: `mintSessionOpsToken(sessionId, projectId)` from Task 1

- [ ] **Step 1: Write failing prompt tests**

```ts
it("never warns that FORGE_OPS_API_TOKEN is not configured", () => {
  delete process.env.FORGE_OPS_API_TOKEN;
  process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
  const text = buildForgeOpsAgentInstructions("proj-1", "sess-1");
  expect(text).not.toContain("WARNING: FORGE_OPS_API_TOKEN is not configured");
  expect(text).toContain(
    "The token is available in your environment as FORGE_OPS_API_TOKEN.",
  );
});
```

Update catalog expectations to mention session tokens / project scope (add fields under `auth` in `forgeOpsApiCatalog`).

- [ ] **Step 2: Run to verify fail**

Run: `./test.sh`  
Expected: FAIL — warning still present when global token unset.

- [ ] **Step 3: Fix prompt**

In `buildForgeOpsAgentInstructions`, remove `isOpsApiConfigured` branch; always emit the “token is available” sentence.

In `forgeOpsApiCatalog`, extend `auth`:

```ts
auth: {
  header: "Authorization: Bearer $FORGE_OPS_API_TOKEN",
  alternateHeader: "X-Forge-Ops-Token: $FORGE_OPS_API_TOKEN",
  agentSessionHeader:
    "X-Forge-Agent-Session-Id: <session-id> (optional, links audit log to your session)",
  sessionTokens:
    "Agents receive a project-scoped session token (fos.<sessionId>.…) in FORGE_OPS_API_TOKEN. Optional global FORGE_OPS_API_TOKEN grants full access for CI.",
},
```

- [ ] **Step 4: Always inject session token in `agent-runner.ts`**

Replace:

```ts
  if (process.env.FORGE_OPS_API_TOKEN?.trim()) {
    env.FORGE_OPS_API_TOKEN = process.env.FORGE_OPS_API_TOKEN.trim();
  }
  env.FORGE_OPS_API_BASE = opsApiBaseUrl();
```

With:

```ts
  env.FORGE_OPS_API_TOKEN = mintSessionOpsToken(sessionId, project.id);
  env.FORGE_OPS_API_BASE = opsApiBaseUrl();
```

Import `mintSessionOpsToken` from `@/lib/ops-api-auth`. Ensure `opsApiBaseUrl` import remains (add import if currently only via other module).

- [ ] **Step 5: Run tests + commit**

Run: `./test.sh`  
Expected: PASS.

```bash
git add src/lib/agent-runner.ts src/lib/agent-ops-prompt.ts src/lib/ops-api.test.ts
git commit -m "$(cat <<'EOF'
Inject session Ops tokens into agents and drop the unset-token warning.

EOF
)"
```

---

### Task 4: Docs and compose env wiring

**Files:**
- Modify: `.env.example`
- Modify: `AGENTS.md`
- Modify: `docker-compose.yml` (pass through `FORGE_OPS_SESSION_SECRET` / optional file path if other secrets are passed that way)

- [ ] **Step 1: Update `.env.example`**

```env
# Optional global Ops API token for CI / host curl (full access).
# Agents always get a per-session HMAC token; this is not required for agents.
# FORGE_OPS_API_TOKEN=change-me-to-a-random-string

# Optional explicit HMAC secret for session ops tokens (auto-generated beside the DB if unset).
# FORGE_OPS_SESSION_SECRET=change-me-to-a-long-random-string
```

- [ ] **Step 2: Update `AGENTS.md` Ops Auth bullet**

Document dual auth: agents use session token in env; global optional; session tokens project-scoped; archive revokes.

- [ ] **Step 3: Wire compose**

In `docker-compose.yml` service env (near existing `FORGE_OPS_API_TOKEN`):

```yaml
FORGE_OPS_SESSION_SECRET: ${FORGE_OPS_SESSION_SECRET:-}
```

- [ ] **Step 4: Commit**

```bash
git add .env.example AGENTS.md docker-compose.yml
git commit -m "$(cat <<'EOF'
Document dual Ops auth and optional session HMAC secret.

EOF
)"
```

---

### Task 5: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `./build.sh --skip-install`  
Expected: exit 0.

- [ ] **Step 2: Test**

Run: `./test.sh`  
Expected: exit 0; confirm ops-api tests cover mint, archive reject, global accept, no WARNING.

- [ ] **Step 3: Self-check against spec**

Confirm:

1. Every non-archived session can mint a token
2. Agent spawn always sets `FORGE_OPS_API_TOKEN`
3. Prompt has no WARNING
4. Global token still works
5. Cross-project session token → 403
6. Archived session → 401

- [ ] **Step 4: Final commit only if docs/tests needed fixing**

Otherwise done.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| HMAC token format `fos.…` | 1 |
| Secret from env or persisted file / memory for `:memory:` | 1 |
| Dual auth global vs session | 1–2 |
| Archive revokes | 1 |
| Project scope + filtered lists | 2 |
| No global-only 503 when secret exists | 1–2 (`isOpsApiConfigured`) |
| Always inject on spawn | 3 |
| Remove WARNING from prompt | 3 |
| Catalog / AGENTS / .env docs | 3–4 |
| Tests listed in spec | 1, 3, 5 |
