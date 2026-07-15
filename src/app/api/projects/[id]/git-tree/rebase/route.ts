import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { branchOpsBlockedResponse } from "@/lib/git-tree-branch-ops";
import { rebaseProjectBranch } from "@/lib/project-git-tree";
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
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
