import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { existsSync } from "fs";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { ensureBranchWorkspace } from "@/lib/branch-workspace";
import {
  hasBranchWorkspaceDirty,
  listBranchEditorFiles,
} from "@/lib/branch-editor";
import { listAvailableBranches } from "@/lib/git-workspace";
import { resolveClonePath } from "@/lib/paths";

export async function GET(
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

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session")?.trim() || null;
  let sessionBranch: string | null = null;
  if (sessionId) {
    const agentSession = db
      .select({
        branch: agentSessions.branch,
        projectId: agentSessions.projectId,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    if (!agentSession || agentSession.projectId !== id) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    sessionBranch = agentSession.branch;
  }

  const branch =
    url.searchParams.get("branch")?.trim() ||
    sessionBranch ||
    project.branch;

  try {
    const workspace = await ensureBranchWorkspace(project, branch);
    const clonePath = resolveClonePath(project.clonePath);
    const branchSource = existsSync(clonePath)
      ? clonePath
      : workspace.workspacePath;
    const branches = await listAvailableBranches(project.branch, branchSource, {
      fetchRemote: false,
    });
    if (!branches.includes(branch)) branches.push(branch);
    branches.sort((a, b) => a.localeCompare(b));

    const files = await listBranchEditorFiles(
      workspace.workspacePath,
      project.branch,
    );
    const dirty = await hasBranchWorkspaceDirty(workspace.workspacePath);

    return NextResponse.json({
      branch,
      watchBranch: project.branch,
      branches,
      files,
      dirty,
      containerStatus: workspace.status,
      sessionId,
      sessionBranch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
