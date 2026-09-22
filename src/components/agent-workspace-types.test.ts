import { describe, expect, it } from "vitest";
import {
  deriveAgentWorkspaceUi,
  type AgentSession,
  type BranchAgentInfo,
} from "@/components/agent-workspace-types";

function branch(
  name: string,
  extras: Partial<BranchAgentInfo> = {},
): BranchAgentInfo {
  return {
    name,
    isDeployBranch: name === "main",
    sessionId: extras.sessionId ?? null,
    sessionStatus: extras.sessionStatus ?? null,
    hasAgent: extras.hasAgent ?? false,
  };
}

function session(
  extras: Partial<AgentSession> & Pick<AgentSession, "id" | "branch" | "status">,
): AgentSession {
  return {
    initialPrompt: "do the thing",
    logs: "",
    errorMessage: null,
    failedTurnStartSeq: null,
    deploymentId: null,
    commitSha: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    ...extras,
  };
}

describe("deriveAgentWorkspaceUi", () => {
  it("splits idle branches from branches that have an agent", () => {
    const ui = deriveAgentWorkspaceUi({
      branches: [
        branch("main"),
        branch("agent/stuck", {
          hasAgent: true,
          sessionId: "s1",
          sessionStatus: "running",
        }),
      ],
      sessions: [
        session({ id: "s1", branch: "agent/stuck", status: "running" }),
      ],
      selectedBranch: "agent/stuck",
      selectedId: "s1",
      sessionDetail: session({ id: "s1", branch: "agent/stuck", status: "running" }),
      hasActiveRuntime: true,
      showRecreateForm: false,
    });
    expect(ui.agentBranches.map((b) => b.name)).toEqual(["agent/stuck"]);
    expect(ui.idleBranches.map((b) => b.name)).toEqual(["main"]);
    expect(ui.showRestartButton).toBe(true);
  });

  it("hides Restart for archived sessions", () => {
    const ui = deriveAgentWorkspaceUi({
      branches: [branch("agent/old", { hasAgent: false })],
      sessions: [],
      selectedBranch: "agent/old",
      selectedId: "s-arch",
      sessionDetail: session({
        id: "s-arch",
        branch: "agent/old",
        status: "failed",
        archivedAt: new Date().toISOString(),
      }),
      hasActiveRuntime: false,
      showRecreateForm: false,
    });
    expect(ui.showRestartButton).toBe(false);
  });
});
