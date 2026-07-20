/**
 * Layer C — live Forge smoke / cutover.
 * Enabled via FORGE_LIVE_SMOKE=1 or agent fos.* token (see live-smoke.ts).
 * Never runs during self-update staging ./test.sh.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import {
  liveSmokeLogsContainForbiddenFailure,
  shouldRunLiveSmoke,
} from "@/lib/live-smoke";

const liveEnabled = shouldRunLiveSmoke();

function opsBase(): string {
  return (process.env.FORGE_OPS_API_BASE ?? "http://127.0.0.1:3000").replace(
    /\/$/,
    "",
  );
}

function opsToken(): string | null {
  return process.env.FORGE_OPS_API_TOKEN?.trim() || null;
}

async function opsFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = opsToken();
  if (!token) throw new Error("FORGE_OPS_API_TOKEN required for live smoke");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${opsBase()}${path}`, { ...init, headers });
}

async function findForgeProjectId(): Promise<string> {
  const res = await opsFetch("/api/ops/projects");
  expect(res.ok).toBe(true);
  const data = (await res.json()) as {
    projects?: Array<{ id: string; name?: string; isForge?: boolean; clonePath?: string }>;
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

async function readForgeUpdateFromDb(
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

async function pollForgeUpdate(
  projectId: string,
  updateId: string,
  timeoutMs = 45 * 60_000,
): Promise<{ status: string; logs: string; errorMessage?: string | null }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await opsFetch(`/api/ops/projects/${projectId}`);
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

    // Fallback: older Forge images omit recentUpdates; cutover also drops the port briefly.
    const fromDb = await readForgeUpdateFromDb(updateId);
    if (fromDb && ["success", "failed", "rolled_back"].includes(fromDb.status)) {
      return fromDb;
    }

    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Timed out waiting for forge update ${updateId}`);
}

describe.skipIf(!liveEnabled)("forge live smoke (Layer C)", () => {
  it("health and container runtime are reachable", async () => {
    const health = await fetch(`${opsBase()}/api/forge/health`).catch(() => null);
    expect(health?.ok).toBe(true);

    // Probe docker info via configured host when possible.
    try {
      execFileSync("docker", ["info"], {
        env: process.env,
        stdio: "ignore",
        timeout: 10_000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toMatch(/Install the buildx component/i);
      throw new Error(
        `Container runtime unreachable (buildx-masked daemon death class): ${message}`,
      );
    }
  });

  it("same-SHA Redeploy Forge via Ops succeeds without forbidden errors", async () => {
    const projectId = await findForgeProjectId();
    const body: Record<string, unknown> = {
      actionDescription:
        "Live smoke: same-SHA Redeploy Forge to protect against buildx/FETCH_HEAD/false-interrupt regressions",
    };
    if (opsToken()?.startsWith("fos.")) {
      body.authorizeActiveSessionDeploy = true;
    }

    const res = await opsFetch(`/api/ops/projects/${projectId}/deploy`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      updateId?: string;
      error?: string;
    };
    expect(res.status, JSON.stringify(payload)).toBe(202);
    expect(payload.updateId).toBeTruthy();

    const result = await pollForgeUpdate(projectId, payload.updateId!);
    const forbidden = liveSmokeLogsContainForbiddenFailure(result.logs);
    expect(forbidden, result.logs.slice(-2000)).toBeNull();
    expect(result.errorMessage ?? "").not.toMatch(/interrupted/i);
    expect(result.status).toBe("success");
  }, 50 * 60_000);

  it("post-cutover Ops remains usable and session is not falsely interrupted", async () => {
    const suiteStartedAt = Date.now() - 10 * 60_000; // ignore interrupts older than this smoke window
    // Cutover briefly drops the port — wait for health before Ops checks.
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      try {
        const health = await fetch(`${opsBase()}/api/forge/health`);
        if (health.ok) break;
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    const projectId = await findForgeProjectId();
    const res = await opsFetch(`/api/ops/projects/${projectId}`);
    expect(res.ok).toBe(true);
    const detail = (await res.json()) as {
      agentSessions?: Array<{
        id: string;
        status: string;
        errorMessage?: string;
        completedAt?: string | null;
      }>;
      forgeStatus?: { activeUpdate?: { status: string } | null };
    };
    expect(detail.forgeStatus?.activeUpdate ?? null).toBeNull();

    const freshFalseInterrupts = (detail.agentSessions ?? []).filter((s) => {
      const interrupted =
        s.errorMessage === "Agent session interrupted" ||
        s.errorMessage ===
          "Agent session did not start (orchestrator restarted or session interrupted)";
      if (!interrupted) return false;
      const completed = s.completedAt ? Date.parse(s.completedAt) : NaN;
      return !Number.isNaN(completed) && completed >= suiteStartedAt;
    });
    expect(freshFalseInterrupts).toEqual([]);
  }, 180_000);
});
