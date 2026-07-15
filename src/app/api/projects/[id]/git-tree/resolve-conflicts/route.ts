import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { createAgentSession } from "@/lib/agent-runner";
import { branchOpsBlockedResponse } from "@/lib/git-tree-branch-ops";
import {
  buildRemoteConflictResolutionPrompt,
  listRemoteConflictBranches,
} from "@/lib/project-git-tree";

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

  const body = (await request.json().catch(() => ({}))) as {
    branch?: string;
  };
  const conflictBranches = await listRemoteConflictBranches(project.clonePath);
  if (conflictBranches.length === 0) {
    return NextResponse.json(
      { error: "No branches with remote conflicts found" },
      { status: 400 },
    );
  }

  const requestedBranch = body.branch?.trim();
  const branch =
    requestedBranch && conflictBranches.includes(requestedBranch)
      ? requestedBranch
      : conflictBranches[0]!;

  try {
    const sessionId = await createAgentSession(
      id,
      branch,
      buildRemoteConflictResolutionPrompt(branch),
    );
    return NextResponse.json({
      sessionId,
      branch,
      conflictBranches,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start conflict resolution";
    const status = message.includes("already active") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
