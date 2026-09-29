import { describe, expect, it } from "vitest";
import {
  filterLiveBranchesWithAgents,
  type LiveBranchInfo,
} from "@/lib/agent-live-branches";

describe("filterLiveBranchesWithAgents", () => {
  it("returns empty when only checkout containers exist (no agent sessions)", () => {
    const live: LiveBranchInfo[] = [
      {
        name: "agent/container-logs",
        sessionId: null,
        sessionStatus: null,
        containerStatus: "running",
      },
      {
        name: "main",
        sessionId: null,
        sessionStatus: null,
        containerStatus: "running",
      },
    ];

    expect(filterLiveBranchesWithAgents(live)).toEqual([]);
  });

  it("keeps only branches that have an active agent session", () => {
    const live: LiveBranchInfo[] = [
      {
        name: "agent/container-logs",
        sessionId: null,
        sessionStatus: null,
        containerStatus: "running",
      },
      {
        name: "agent/fix-running-agents-status",
        sessionId: "sess-1",
        sessionStatus: "running",
        containerStatus: "paused",
      },
      {
        name: "main",
        sessionId: null,
        sessionStatus: null,
        containerStatus: "running",
      },
    ];

    expect(filterLiveBranchesWithAgents(live)).toEqual([
      {
        name: "agent/fix-running-agents-status",
        sessionId: "sess-1",
        sessionStatus: "running",
        containerStatus: "paused",
      },
    ]);
  });
});
