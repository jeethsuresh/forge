import { describe, expect, it } from "vitest";
import { modeStatuses, projectRowTone } from "./mode-status";
import type { ModeStatusSignals } from "./mode-status";

const base: ModeStatusSignals = {
  runtimeStatus: "running",
  isDeploying: false,
  latestDeployStatus: "success",
  hasAttention: false,
  agentLive: false,
  workingTreeDirty: false,
};

describe("modeStatuses", () => {
  it("marks deploy warning while deploying and agents info when live", () => {
    const tones = modeStatuses({
      ...base,
      isDeploying: true,
      agentLive: true,
      workingTreeDirty: true,
    });
    expect(tones.deploy).toBe("warning");
    expect(tones.agents).toBe("info");
    expect(tones.changes).toBe("warning");
  });

  it("marks overview warning when attention is set", () => {
    expect(modeStatuses({ ...base, hasAttention: true }).overview).toBe(
      "warning",
    );
  });
});

describe("projectRowTone", () => {
  it("prioritizes failed deploy and live agent", () => {
    expect(
      projectRowTone({ ...base, latestDeployStatus: "failed" }),
    ).toBe("danger");
    expect(projectRowTone({ ...base, agentLive: true })).toBe("info");
  });
});
