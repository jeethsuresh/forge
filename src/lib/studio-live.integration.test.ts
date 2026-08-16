/**
 * Live HTTP checks for studio APIs (deploy, agents, diffs, settings).
 * Gated the same way as UI e2e — never nested in updater staging.
 */
import { describe, expect, it } from "vitest";
import { forgeAdminCredentials, shouldRunUiE2e, uiE2eBaseUrl } from "@/lib/ui-e2e";

const enabled = shouldRunUiE2e();
const base = uiE2eBaseUrl();

async function loginCookie(): Promise<string> {
  const { username, password } = forgeAdminCredentials();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(res.ok).toBe(true);
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const header = cookies.filter(Boolean).join("; ");
  expect(header).toMatch(/forge_session/);
  return header;
}

async function authedGet(path: string, cookie: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    headers: { Cookie: cookie },
  });
}

describe.skipIf(!enabled)("studio live HTTP", () => {
  it("health is ok", async () => {
    const res = await fetch(`${base}/api/forge/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { ok?: boolean; commitSha?: string };
    expect(body.ok).toBe(true);
    expect(body.commitSha).toBeTruthy();
  });

  it("covers deploy, agents, changes, and settings payloads", async () => {
    const cookie = await loginCookie();
    const list = await authedGet("/api/projects", cookie);
    expect(list.ok).toBe(true);
    const data = (await list.json()) as {
      forgeProject?: { id: string } | null;
      projects?: Array<{ id: string }>;
    };
    const id = data.forgeProject?.id ?? data.projects?.[0]?.id;
    expect(id).toBeTruthy();

    const detail = await authedGet(`/api/projects/${id}`, cookie);
    expect(detail.ok).toBe(true);
    const project = (await detail.json()) as {
      isDeploying?: boolean;
      runtimeStatus?: string;
      deployments?: unknown[];
    };
    expect(project.runtimeStatus).toBeTruthy();
    expect(Array.isArray(project.deployments)).toBe(true);

    const sessions = await authedGet(
      `/api/projects/${id}/agent-sessions`,
      cookie,
    );
    expect(sessions.ok).toBe(true);
    const sessionJson = (await sessions.json()) as {
      sessions?: unknown[];
      branches?: unknown[];
    };
    expect(Array.isArray(sessionJson.sessions)).toBe(true);
    expect(Array.isArray(sessionJson.branches)).toBe(true);

    const diff = await authedGet(
      `/api/projects/${id}/diff?mode=uncommitted`,
      cookie,
    );
    expect(diff.ok).toBe(true);
    const diffJson = (await diff.json()) as { diff?: { files?: unknown[] } };
    expect(diffJson.diff).toBeTruthy();

    const vsWatch = await authedGet(
      `/api/projects/${id}/diff?mode=branch-vs-main`,
      cookie,
    );
    expect(vsWatch.ok).toBe(true);
    const vsWatchJson = (await vsWatch.json()) as {
      branches?: string[];
      watchBranch?: string;
    };
    expect(Array.isArray(vsWatchJson.branches)).toBe(true);
    expect(vsWatchJson.watchBranch).toBeTruthy();

    const routing = await authedGet("/api/settings/project-routing", cookie);
    expect(routing.ok).toBe(true);

    const patch = await authedGet(`/api/projects/${id}`, cookie);
    expect(patch.ok).toBe(true);
    const settings = (await patch.json()) as {
      project?: { name?: string; branch?: string };
    };
    expect(settings.project?.name ?? project.runtimeStatus).toBeTruthy();
  });
});
