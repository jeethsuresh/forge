import { describe, expect, it } from "vitest";
import { attentionForProject, collectAttention } from "@/lib/fleet-attention";

const base = {
  id: "p1",
  name: "App",
  branch: "main",
  enabled: true,
  isDeploying: false,
  runtimeStatus: "running" as const,
  latestDeployment: { status: "success" },
};

describe("attentionForProject", () => {
  it("flags failed deploys", () => {
    const item = attentionForProject({
      ...base,
      latestDeployment: { status: "failed" },
    });
    expect(item?.reason).toBe("failed_deploy");
  });

  it("returns null when healthy", () => {
    expect(attentionForProject(base)).toBeNull();
  });
});

describe("collectAttention", () => {
  it("collects multiple issues", () => {
    const items = collectAttention([
      base,
      {
        ...base,
        id: "p2",
        name: "B",
        runtimeStatus: "stopped",
        latestDeployment: { status: "success" },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe("stopped");
  });
});
