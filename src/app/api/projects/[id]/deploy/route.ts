import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { runDeployment } from "@/lib/deployer";
import { isAgentSessionActive, getBlockingAgentSession } from "@/lib/agent-state";
import { isForgeProject } from "@/lib/forge-project";
import { validateBranchName } from "@/lib/github";
import {
  invalidateProjectBranches,
} from "@/lib/project-branches-cache";
import { invalidateProjectRuntimeCache } from "@/lib/project-runtime-cache";
import { startForgeUpdate } from "@/lib/self-update";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (isAgentSessionActive(id)) {
    const blocking = getBlockingAgentSession(id);
    return NextResponse.json(
      {
        error: "An agent session is active. End it on the Agents tab before deploying.",
        blockingAgentSession: blocking
          ? {
              id: blocking.id,
              branch: blocking.branch,
              status: blocking.status,
            }
          : null,
      },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { branch?: string };
  const branch = body.branch?.trim() || project.branch;
  const validationError = validateBranchName(branch);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  if (isForgeProject(project)) {
    try {
      const updateId = await startForgeUpdate({ branch });
      invalidateProjectRuntimeCache(id);
      return NextResponse.json(
        { updateId, branch, mode: "forge-self-update" },
        { status: 202 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      return NextResponse.json({ error: message }, { status: 409 });
    }
  }

  try {
    const deploymentId = await runDeployment(id, "manual", { branch });
    invalidateProjectRuntimeCache(id);
    invalidateProjectBranches(id);
    return NextResponse.json({ deploymentId, branch }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deploy failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
