import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { containerLogs, projects } from "@/lib/db/schema";
import {
  CONTAINER_LOG_MAX_CHARS,
  captureComposeContainerLogs,
  formatContainerLogExcerpt,
  formatInspectError,
  getContainerLogSnapshot,
  getOrRefreshContainerLogs,
  parseContainerLogQuery,
  sanitizeContainerLogs,
  setContainerLogsDockerRunner,
  upsertContainerLogSnapshot,
} from "@/lib/container-logs";

describe("sanitizeContainerLogs", () => {
  it("redacts ops tokens and bearer headers", () => {
    const raw = [
      "boot ok",
      "Authorization: Bearer fos.sess.secretmac",
      "FORGE_OPS_API_TOKEN=fos.other.secretmac",
      "clone with fgc.abc.secret",
    ].join("\n");
    const cleaned = sanitizeContainerLogs(raw);
    expect(cleaned).toContain("boot ok");
    expect(cleaned).not.toContain("secretmac");
    expect(cleaned).not.toContain("fgc.abc.secret");
    expect(cleaned).toMatch(/\[redacted\]/);
    expect(cleaned).toMatch(/fgc\.\[redacted\]/);
  });
});

describe("parseContainerLogQuery", () => {
  it("parses tail and refresh flags", () => {
    expect(parseContainerLogQuery(new URL("http://x/logs"))).toEqual({
      tail: 200,
      refresh: false,
    });
    expect(
      parseContainerLogQuery(new URL("http://x/logs?tail=50&refresh=1")),
    ).toEqual({ tail: 50, refresh: true });
  });
});

describe("formatContainerLogExcerpt", () => {
  it("keeps the tail when over the cap", () => {
    const raw = `${"a".repeat(CONTAINER_LOG_MAX_CHARS)}TAIL`;
    const excerpt = formatContainerLogExcerpt(raw);
    expect(excerpt.length).toBe(CONTAINER_LOG_MAX_CHARS);
    expect(excerpt.endsWith("TAIL")).toBe(true);
  });
});

describe("formatInspectError", () => {
  it("formats start failure from inspect state", () => {
    expect(
      formatInspectError({
        Error: "executable file not found",
        ExitCode: 127,
        OOMKilled: false,
        Status: "exited",
      }),
    ).toMatch(/executable file not found/);
  });

  it("returns null when inspect has no error and zero exit", () => {
    expect(
      formatInspectError({
        Error: "",
        ExitCode: 0,
        OOMKilled: false,
        Status: "running",
      }),
    ).toBeNull();
  });
});

describe("container log snapshots", () => {
  let projectId: string;

  beforeEach(() => {
    projectId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Logs Project",
        githubRepo: "owner/logs",
        branch: "main",
        clonePath: `/tmp/${projectId}`,
        enabled: true,
        deployEnvJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    setContainerLogsDockerRunner(null);
  });

  afterEach(() => {
    db.delete(containerLogs)
      .where(eq(containerLogs.projectId, projectId))
      .run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    setContainerLogsDockerRunner(null);
  });

  it("upserts the latest snapshot for a container name", () => {
    upsertContainerLogSnapshot({
      projectId,
      composeSlug: "demo",
      containerName: "demo_app_1",
      service: "app",
      state: "exited",
      status: "Exited (1)",
      logs: "first",
      inspectError: null,
      deploymentId: "dep-1",
    });
    upsertContainerLogSnapshot({
      projectId,
      composeSlug: "demo",
      containerName: "demo_app_1",
      service: "app",
      state: "exited",
      status: "Exited (1)",
      logs: "second",
      inspectError: "boom",
      deploymentId: "dep-2",
    });

    const row = getContainerLogSnapshot(projectId, "demo_app_1");
    expect(row).toMatchObject({
      logs: "second",
      inspectError: "boom",
      deploymentId: "dep-2",
    });
  });

  it("captures docker logs and inspect errors for compose containers", async () => {
    setContainerLogsDockerRunner(async (args) => {
      if (args[0] === "logs") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "inspect") {
        return {
          stdout: JSON.stringify({
            Error: "failed to start",
            ExitCode: 127,
            OOMKilled: false,
            Status: "exited",
          }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    const captured = await captureComposeContainerLogs({
      projectId,
      composeSlug: "demo",
      deploymentId: "dep-fail",
      containers: [
        {
          name: "demo_app_1",
          service: "app",
          state: "exited",
          status: "Exited (127)",
          ports: "",
        },
      ],
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.logs).toMatch(/failed to start/);
    expect(captured[0]?.inspectError).toMatch(/failed to start/);
    expect(getContainerLogSnapshot(projectId, "demo_app_1")?.deploymentId).toBe(
      "dep-fail",
    );
  });

  it("getOrRefreshContainerLogs tails stored text and can refresh live", async () => {
    upsertContainerLogSnapshot({
      projectId,
      composeSlug: "demo",
      containerName: "demo_app_1",
      service: "app",
      state: "running",
      status: "Up",
      logs: "line-a\nline-b\nline-c",
      inspectError: null,
      deploymentId: null,
    });

    const stored = await getOrRefreshContainerLogs({
      projectId,
      containerName: "demo_app_1",
      tail: 2,
      refresh: false,
    });
    expect(stored?.logs).toBe("line-b\nline-c");
    expect(stored?.refreshed).toBe(false);

    setContainerLogsDockerRunner(async (args) => {
      if (args[0] === "logs") {
        return { stdout: "live-1\nlive-2\n", stderr: "" };
      }
      if (args[0] === "inspect") {
        return {
          stdout: JSON.stringify({
            Error: "",
            ExitCode: 0,
            Status: "running",
          }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    const live = await getOrRefreshContainerLogs({
      projectId,
      containerName: "demo_app_1",
      composeSlug: "demo",
      service: "app",
      state: "running",
      status: "Up",
      tail: 50,
      refresh: true,
    });
    expect(live?.logs).toMatch(/live-2/);
    expect(live?.refreshed).toBe(true);
  });
});
