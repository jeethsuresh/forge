import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveAgentWorkspaceUi,
  isAgentCommitDeployed,
  parseAgentSidebarSort,
  sortAgentBranches,
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

  it("counts live completed agents for cleanup", () => {
    const ui = deriveAgentWorkspaceUi({
      branches: [
        branch("agent/done", {
          hasAgent: true,
          sessionId: "s-done",
          sessionStatus: "completed",
        }),
        branch("agent/live", {
          hasAgent: true,
          sessionId: "s-live",
          sessionStatus: "running",
        }),
      ],
      sessions: [
        session({ id: "s-done", branch: "agent/done", status: "completed" }),
        session({ id: "s-live", branch: "agent/live", status: "running" }),
      ],
      selectedBranch: "agent/live",
      selectedId: "s-live",
      sessionDetail: session({ id: "s-live", branch: "agent/live", status: "running" }),
      hasActiveRuntime: true,
      showRecreateForm: false,
    });
    expect(ui.completedAgentCount).toBe(1);
  });
});

describe("parseAgentSidebarSort", () => {
  it("defaults unknown values to most recently used", () => {
    expect(parseAgentSidebarSort(null)).toBe("recent");
    expect(parseAgentSidebarSort("nope")).toBe("recent");
    expect(parseAgentSidebarSort("branch")).toBe("branch");
    expect(parseAgentSidebarSort("status")).toBe("status");
  });
});

describe("sortAgentBranches", () => {
  const branches: BranchAgentInfo[] = [
    branch("zeta/live", { hasAgent: true, sessionId: "s-live", sessionStatus: "running" }),
    branch("alpha/fail", { hasAgent: true, sessionId: "s-fail", sessionStatus: "failed" }),
    branch("mu/old", { hasAgent: true, sessionId: "s-old", sessionStatus: "completed" }),
  ];
  const sessions: AgentSession[] = [
    session({
      id: "s-old",
      branch: "mu/old",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    }),
    session({
      id: "s-live",
      branch: "zeta/live",
      status: "running",
      startedAt: "2026-01-02T00:00:00.000Z",
      lastUsedAt: "2026-01-03T00:00:00.000Z",
    }),
    session({
      id: "s-fail",
      branch: "alpha/fail",
      status: "failed",
      startedAt: "2026-01-02T12:00:00.000Z",
      lastUsedAt: "2026-01-02T12:00:00.000Z",
    }),
  ];

  it("sorts by most recently used first", () => {
    expect(sortAgentBranches(branches, sessions, "recent").map((b) => b.name)).toEqual([
      "zeta/live",
      "alpha/fail",
      "mu/old",
    ]);
  });

  it("sorts by branch name", () => {
    expect(sortAgentBranches(branches, sessions, "branch").map((b) => b.name)).toEqual([
      "alpha/fail",
      "mu/old",
      "zeta/live",
    ]);
  });

  it("sorts run status as running, then failed, then completed", () => {
    expect(sortAgentBranches(branches, sessions, "status").map((b) => b.name)).toEqual([
      "zeta/live",
      "alpha/fail",
      "mu/old",
    ]);
  });
});

describe("isAgentCommitDeployed", () => {
  it("matches prefix-equal commit SHAs against the live deploy", () => {
    expect(
      isAgentCommitDeployed(
        { commitSha: "abc1234deadbeef" },
        "abc1234deadbeef99",
      ),
    ).toBe(true);
    expect(isAgentCommitDeployed({ commitSha: "abc1234deadbeef" }, "fff0000")).toBe(
      false,
    );
    expect(isAgentCommitDeployed({ commitSha: null }, "abc1234")).toBe(false);
  });
});

describe("useAgentWorkspace return object", () => {
  it("does not list sortedAgentBranches twice (next build typecheck)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/useAgentWorkspace.ts"),
      "utf8",
    );
    const block = src.match(/\n  return \{([\s\S]*)\n  \};\n\}\s*$/);
    expect(block).not.toBeNull();
    const keys = [...block![1].matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*),$/gm)].map(
      (m) => m[1],
    );
    expect(keys.filter((k) => k === "sortedAgentBranches")).toEqual([
      "sortedAgentBranches",
    ]);
    const dups = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(dups).toEqual([]);
  });
});
