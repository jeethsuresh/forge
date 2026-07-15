import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  getBlockingAgentSession,
  isAgentSessionActive,
} from "@/lib/agent-state";
import { isDeploymentActive } from "@/lib/deployer";
import { rebaseProjectBranch } from "@/lib/project-git-tree";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import { startRebaseRecovery } from "@/lib/rebase-recovery";

function branchOpsBlockedResponse(projectId: string) {
  if (isAgentSessionActive(projectId)) {
    const blocking = getBlockingAgentSession(projectId);
    return NextResponse.json(
      {
        error:
          "An agent session is active. End it on the Agents tab before changing branches.",
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

  if (isDeploymentActive(projectId)) {
    return NextResponse.json(
      { error: "A deployment is in progress. Wait for it to finish." },
      { status: 409 },
    );
  }

  return null;
}

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

  const blocked = branchOpsBlockedResponse(id);
  if (blocked) return blocked;

  const body = (await request.json()) as { branch?: string; onto?: string };
  const branch = body.branch?.trim() ?? "";
  const onto = body.onto?.trim() ?? "";
  if (!branch || !onto) {
    return NextResponse.json(
      { error: "branch and onto are required" },
      { status: 400 },
    );
  }

  try {
    await rebaseProjectBranch(project.clonePath, branch, onto);
    invalidateProjectBranches(id);
    return NextResponse.json({ success: true, branch, onto });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rebase failed";
    try {
      const recovery = await startRebaseRecovery(project, branch, onto, message);
      invalidateProjectBranches(id);

      if (recovery.autoFinalized) {
        return NextResponse.json({
          success: true,
          branch,
          onto,
          recovered: true,
          recoveryBranch: recovery.recoveryBranch,
        });
      }

      return NextResponse.json(
        {
          recovered: true,
          recoverySessionId: recovery.sessionId,
          recoveryBranch: recovery.recoveryBranch,
          cherryPickState: recovery.cherryPickState,
          branch,
          onto,
          error: message,
        },
        { status: 202 },
      );
    } catch (recoveryErr) {
      const recoveryMessage =
        recoveryErr instanceof Error ? recoveryErr.message : "Recovery failed";
      return NextResponse.json(
        { error: message, recoveryError: recoveryMessage },
        { status: 409 },
      );
    }
  }
}
