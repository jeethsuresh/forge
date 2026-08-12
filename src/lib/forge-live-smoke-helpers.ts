/**
 * Shared helpers for Forge Layer C live smoke tests.
 * See docs/superpowers/specs/2026-07-20-deploy-agent-resilience-tests-design.md
 */
import { execFileSync } from "child_process";
import { createHmac } from "crypto";

export const FORGE_LIVE_SMOKE_MARKER_PATH = "public/forge-live-smoke-marker.txt";
export const FORGE_LIVE_SMOKE_MARKER_CONTAINER_PATH =
  "/app/public/forge-live-smoke-marker.txt";

export function opsBase(): string {
  return (process.env.FORGE_OPS_API_BASE ?? "http://127.0.0.1:3000").replace(
    /\/$/,
    "",
  );
}

export async function resolveWorkingLiveSmokeOpsToken(): Promise<string> {
  const candidates = [
    process.env.FORGE_OPS_API_TOKEN?.trim(),
    null as string | null,
  ].filter((t): t is string => Boolean(t));

  for (const token of candidates) {
    try {
      const res = await opsFetch("/api/ops/projects", undefined, token);
      if (res.ok) return token;
    } catch {
      // try next
    }
  }

  const minted = mintForgeSessionOpsToken();
  const res = await opsFetch("/api/ops/projects", undefined, minted);
  if (!res.ok) {
    throw new Error(
      `Could not authenticate to Ops (env token and minted fos.* both failed: ${res.status})`,
    );
  }
  return minted;
}

export function mintForgeSessionOpsToken(projectId?: string): string {
  const secret = execFileSync(
    "docker",
    ["exec", "forge_app_1", "cat", "/data/forge-ops-session-secret"],
    { encoding: "utf8" },
  ).trim();
  if (!secret) {
    throw new Error("No forge ops session secret inside forge_app_1");
  }

  const forgeProjectId =
    projectId ??
    execFileSync(
      "docker",
      [
        "exec",
        "forge_app_1",
        "sqlite3",
        "/data/forge.db",
        "SELECT id FROM projects WHERE clone_path LIKE '%forge-source%' OR name LIKE '%Forge%' OR name LIKE '%Orchestrator%' LIMIT 1;",
      ],
      { encoding: "utf8" },
    ).trim();

  const sessionId = execFileSync(
    "docker",
    [
      "exec",
      "forge_app_1",
      "sqlite3",
      "/data/forge.db",
      `SELECT id FROM agent_sessions WHERE project_id='${forgeProjectId.replace(/'/g, "''")}' AND archived_at IS NULL ORDER BY started_at DESC LIMIT 1;`,
    ],
    { encoding: "utf8" },
  ).trim();

  if (!sessionId) {
    throw new Error(
      "No agent session available to mint fos.* Ops token; set FORGE_OPS_API_TOKEN",
    );
  }

  const mac = createHmac("sha256", secret)
    .update(`forge-ops-v1:${sessionId}:${forgeProjectId}`)
    .digest("base64url");
  return `fos.${sessionId}.${mac}`;
}

export async function opsFetch(
  path: string,
  init?: RequestInit,
  token?: string,
): Promise<Response> {
  const auth = token ?? process.env.FORGE_OPS_API_TOKEN?.trim();
  if (!auth) {
    throw new Error("FORGE_OPS_API_TOKEN required for live smoke Ops calls");
  }
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${auth}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${opsBase()}${path}`, { ...init, headers });
}

export async function findForgeProjectId(token?: string): Promise<string> {
  const res = await opsFetch("/api/ops/projects", undefined, token);
  if (!res.ok) {
    throw new Error(`Ops /projects failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    projects?: Array<{
      id: string;
      name?: string;
      isForge?: boolean;
      clonePath?: string;
    }>;
  };
  const projects = data.projects ?? [];
  const forge =
    projects.find((p) => p.isForge) ??
    projects.find((p) => /forge|orchestrator/i.test(p.name ?? "")) ??
    projects.find((p) => (p.clonePath ?? "").includes("forge-source"));
  if (!forge) {
    throw new Error("Could not find Forge project via Ops API");
  }
  return forge.id;
}

export async function readForgeUpdateFromDb(
  updateId: string,
): Promise<{ status: string; logs: string; errorMessage?: string | null } | null> {
  try {
    const out = execFileSync(
      "docker",
      [
        "exec",
        "forge_app_1",
        "sqlite3",
        "-json",
        "/data/forge.db",
        `SELECT status, logs, error_message AS errorMessage FROM forge_updates WHERE id='${updateId.replace(/'/g, "''")}';`,
      ],
      { encoding: "utf8", timeout: 15_000 },
    ).trim();
    if (!out) return null;
    const rows = JSON.parse(out) as Array<{
      status: string;
      logs: string;
      errorMessage?: string | null;
    }>;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function pollForgeUpdate(
  projectId: string,
  updateId: string,
  token?: string,
  timeoutMs = 45 * 60_000,
): Promise<{ status: string; logs: string; errorMessage?: string | null }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await opsFetch(
        `/api/ops/projects/${projectId}`,
        undefined,
        token,
      );
      if (res.ok) {
        const data = (await res.json()) as {
          forgeStatus?: {
            activeUpdate?: {
              id: string;
              status: string;
              logs?: string;
              errorMessage?: string | null;
            } | null;
            recentUpdates?: Array<{
              id: string;
              status: string;
              logs?: string;
              errorMessage?: string | null;
            }>;
          };
        };
        const candidates = [
          data.forgeStatus?.activeUpdate,
          ...(data.forgeStatus?.recentUpdates ?? []),
        ].filter(Boolean) as Array<{
          id: string;
          status: string;
          logs?: string;
          errorMessage?: string | null;
        }>;

        const match = candidates.find((u) => u.id === updateId);
        if (
          match &&
          ["success", "failed", "rolled_back"].includes(match.status)
        ) {
          return {
            status: match.status,
            logs: match.logs ?? "",
            errorMessage: match.errorMessage,
          };
        }
        process.stdout.write(
          `live-smoke: waiting for update ${updateId.slice(0, 8)}… ops=${match?.status ?? "n/a"}\n`,
        );
      } else {
        process.stdout.write(
          `live-smoke: waiting for update ${updateId.slice(0, 8)}… ops_http=${res.status}\n`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `live-smoke: waiting for update ${updateId.slice(0, 8)}… ops_error=${message.slice(0, 80)}\n`,
      );
    }

    const fromDb = await readForgeUpdateFromDb(updateId);
    if (fromDb && ["success", "failed", "rolled_back"].includes(fromDb.status)) {
      return fromDb;
    }

    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Timed out waiting for forge update ${updateId}`);
}

export function createForgeSmokeBranch(branch: string): void {
  // Must run as the keep-id app user (`node`). Creating refs as root leaves
  // Permission denied on later agent git commit (FETCH_HEAD / branch.lock).
  execFileSync(
    "docker",
    [
      "exec",
      "-u",
      "node",
      "forge_app_1",
      "bash",
      "-lc",
      [
        "set -euo pipefail",
        "cd /data/forge-source",
        "git fetch origin",
        "git checkout main",
        "git reset --hard origin/main",
        `git checkout -B ${JSON.stringify(branch)}`,
      ].join(" && "),
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
}

export async function pollAgentSession(
  projectId: string,
  sessionId: string,
  token: string,
  timeoutMs = 30 * 60_000,
): Promise<{
  status: string;
  commitSha?: string | null;
  errorMessage?: string | null;
  branch: string;
}> {
  const terminal = new Set(["completed", "failed", "cancelled"]);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await opsFetch(
      `/api/ops/projects/${projectId}/agent-sessions/${sessionId}`,
      undefined,
      token,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        session?: {
          status: string;
          commitSha?: string | null;
          errorMessage?: string | null;
          branch: string;
        };
      };
      const session = data.session;
      if (session) {
        process.stdout.write(
          `live-smoke: agent ${sessionId.slice(0, 8)} status=${session.status}\n`,
        );
        if (terminal.has(session.status)) {
          return {
            status: session.status,
            commitSha: session.commitSha,
            errorMessage: session.errorMessage,
            branch: session.branch,
          };
        }
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for agent session ${sessionId}`);
}

export async function waitForForgeHealth(timeoutMs = 120_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await fetch(`${opsBase()}/api/forge/health`);
      if (health.ok) return;
    } catch {
      // retry during cutover
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Forge health did not recover after cutover");
}

export function readLiveSmokeMarkerFromContainer(): string {
  return execFileSync(
    "docker",
    ["exec", "forge_app_1", "cat", FORGE_LIVE_SMOKE_MARKER_CONTAINER_PATH],
    { encoding: "utf8", timeout: 15_000 },
  ).trim();
}
