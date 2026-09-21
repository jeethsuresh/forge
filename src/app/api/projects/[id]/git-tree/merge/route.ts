import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { branchOpsBlockedResponse } from "@/lib/git-tree-branch-ops";
import { mergeProjectBranch } from "@/lib/project-git-tree";
import { endAgentAndDestroyBranchWorkspace } from "@/lib/agent-runner";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";

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

  const body = (await request.json()) as {
    branch?: string;
    into?: string;
    deleteLocal?: boolean;
  };
  const branch = body.branch?.trim() ?? "";
  const into = body.into?.trim() ?? "";
  const deleteLocal = body.deleteLocal === true;
  if (!branch || !into) {
    return NextResponse.json(
      { error: "branch and into are required" },
      { status: 400 },
    );
  }

  try {
    await mergeProjectBranch(project.clonePath, branch, into, {
      deleteLocal,
      watchBranch: project.branch,
    });
    await endAgentAndDestroyBranchWorkspace(id, branch, "branch_merged");
    invalidateProjectBranches(id);
    return NextResponse.json({ success: true, branch, into, deleteLocal });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Merge failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
