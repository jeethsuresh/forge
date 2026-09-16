import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { DeployProjectError, deployProject } from "@/lib/project-deploy";
import { activeAgentProjects } from "@/lib/agent-state";

describe("deployProject façade", () => {
  const projectId = randomUUID();
  const sessionId = randomUUID();

  afterEach(() => {
    activeAgentProjects.delete(projectId);
    db.delete(agentSessions).where(eq(agentSessions.projectId, projectId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("rejects deploys while an agent session is active unless authorized", async () => {
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "deploy-facade",
        githubRepo: "",
        branch: "main",
        clonePath: "/tmp/deploy-facade",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/x",
        status: "running",
        initialPrompt: "go",
        logs: "",
        startedAt: now,
      })
      .run();
    activeAgentProjects.add(projectId);

    await expect(deployProject({ projectId, trigger: "manual" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(deployProject({ projectId, trigger: "manual" })).rejects.toBeInstanceOf(
      DeployProjectError,
    );
  });

  it("does not treat an active agent as blocking when trigger is agent", async () => {
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "deploy-facade",
        githubRepo: "",
        branch: "main",
        clonePath: "/tmp/deploy-facade",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/x",
        status: "running",
        initialPrompt: "go",
        logs: "",
        startedAt: now,
      })
      .run();
    activeAgentProjects.add(projectId);

    try {
      await deployProject({ projectId, trigger: "agent" });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toMatch(/agent session is active/i);
    }
  });
});
