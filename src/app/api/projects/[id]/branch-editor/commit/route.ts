import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { ensureBranchWorkspace } from "@/lib/branch-workspace";
import { commitBranchEditorChanges } from "@/lib/branch-editor";

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

  let message: string | undefined;
  let branch = project.branch;
  try {
    const body = (await request.json()) as {
      message?: string;
      branch?: string;
    };
    message = body.message?.trim();
    if (body.branch?.trim()) branch = body.branch.trim();
  } catch {
    // optional body
  }

  const commitMessage =
    message && message.length > 0
      ? message
      : "Manual commit from Changes tab";

  try {
    const workspace = await ensureBranchWorkspace(project, branch);
    const result = await commitBranchEditorChanges(
      workspace.workspacePath,
      branch,
      commitMessage,
    );
    return NextResponse.json(result);
  } catch (err) {
    const errMessage =
      err instanceof Error ? err.message : "Failed to commit changes";
    return NextResponse.json({ error: errMessage }, { status: 409 });
  }
}
