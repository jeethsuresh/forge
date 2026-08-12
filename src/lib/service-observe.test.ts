import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, serviceDirectory } from "@/lib/db/schema";
import { listServiceDirectory, upsertDeclaredService } from "@/lib/service-directory";
import {
  observeDeployTargetPorts,
  parsePublishedHostPorts,
} from "@/lib/service-observe";

vi.mock("@/lib/docker", () => ({
  getComposeContainerStatus: vi.fn(),
}));

import { getComposeContainerStatus } from "@/lib/docker";

const mockedStatus = vi.mocked(getComposeContainerStatus);

describe("parsePublishedHostPorts", () => {
  it("parses host:container/proto lists", () => {
    expect(parsePublishedHostPorts("3456:3000/tcp, 9090:9090/tcp")).toEqual([
      3456, 9090,
    ]);
  });

  it("parses Publisher URL style ip:host", () => {
    expect(parsePublishedHostPorts("0.0.0.0:8080")).toEqual([8080]);
  });

  it("returns empty for blank", () => {
    expect(parsePublishedHostPorts("")).toEqual([]);
  });
});

describe("observeDeployTargetPorts", () => {
  let projectId: string;

  beforeEach(() => {
    projectId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Observe Project",
        githubRepo: "owner/observe",
        branch: "main",
        clonePath: `/tmp/${projectId}`,
        enabled: true,
        deployEnvJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    upsertDeclaredService({
      projectId,
      deployTarget: "web",
      portName: "http",
      port: 8080,
      public: true,
      subdomain: "demo",
    });
    upsertDeclaredService({
      projectId,
      deployTarget: "web",
      portName: "metrics",
      port: 9091,
      public: false,
      subdomain: null,
    });
    mockedStatus.mockReset();
  });

  afterEach(() => {
    db.delete(serviceDirectory)
      .where(eq(serviceDirectory.projectId, projectId))
      .run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("marks matching published ports as up with boundPort", async () => {
    mockedStatus.mockResolvedValue([
      {
        name: "web-1",
        service: "app",
        state: "running",
        status: "Up",
        ports: "8080:3000/tcp, 9091:9091/tcp",
      },
    ]);

    await observeDeployTargetPorts({
      projectId,
      deployTarget: "web",
      composeSlug: "observe-web",
      deploymentId: "dep-1",
      commitSha: "abc123",
    });

    const rows = listServiceDirectory({ projectId });
    expect(rows.find((r) => r.portName === "http")).toMatchObject({
      boundPort: 8080,
      status: "up",
      deploymentId: "dep-1",
      commitSha: "abc123",
    });
    expect(rows.find((r) => r.portName === "metrics")).toMatchObject({
      boundPort: 9091,
      status: "up",
    });
    expect(mockedStatus).toHaveBeenCalledWith(
      `/tmp/${projectId}`,
      "observe-web",
    );
  });

  it("marks services down when containers are missing", async () => {
    mockedStatus.mockResolvedValue([]);

    await observeDeployTargetPorts({
      projectId,
      deployTarget: "web",
      composeSlug: "observe-web",
      deploymentId: "dep-2",
      commitSha: "def456",
    });

    for (const row of listServiceDirectory({ projectId })) {
      expect(row).toMatchObject({
        status: "down",
        boundPort: null,
        deploymentId: "dep-2",
        commitSha: "def456",
      });
    }
  });

  it("marks unpublished declared ports down while others stay up", async () => {
    mockedStatus.mockResolvedValue([
      {
        name: "web-1",
        service: "app",
        state: "running",
        status: "Up",
        ports: "8080:3000/tcp",
      },
    ]);

    await observeDeployTargetPorts({
      projectId,
      deployTarget: "web",
      composeSlug: "observe-web",
      deploymentId: "dep-3",
      commitSha: "ghi789",
    });

    expect(
      listServiceDirectory({ projectId }).find((r) => r.portName === "http"),
    ).toMatchObject({ status: "up", boundPort: 8080 });
    expect(
      listServiceDirectory({ projectId }).find((r) => r.portName === "metrics"),
    ).toMatchObject({ status: "down", boundPort: null });
  });
});
