import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { isDeploymentActive } from "@/lib/deployer";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import { finalizeRebaseRecovery } from "@/lib/rebase-recovery";

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

  if (isDeploymentActive(id)) {
    return NextResponse.json(
      { error: "A deployment is in progress. Wait for it to finish." },
      { status: 409 },
    );
  }

  const body = (await request.json()) as {
    recoveryBranch?: string;
    sourceBranch?: string;
  };
  const recoveryBranch = body.recoveryBranch?.trim() ?? "";
  const sourceBranch = body.sourceBranch?.trim() ?? "";
  if (!recoveryBranch || !sourceBranch) {
    return NextResponse.json(
      { error: "recoveryBranch and sourceBranch are required" },
      { status: 400 },
    );
  }

  try {
    await finalizeRebaseRecovery(project.clonePath, recoveryBranch, sourceBranch, {
      watchBranch: project.branch,
    });
    invalidateProjectBranches(id);
    return NextResponse.json({
      success: true,
      recoveryBranch,
      sourceBranch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Finalize failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
