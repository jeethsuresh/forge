import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { branchOpsBlockedResponse } from "@/lib/git-tree-branch-ops";
import { rebaseProjectBranch } from "@/lib/project-git-tree";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import { startRebaseRecovery } from "@/lib/rebase-recovery";

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
