import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  endAgentAndDestroyBranchWorkspace,
  getSessionForBranch,
} from "@/lib/agent-runner";
import { listLocalBranches } from "@/lib/git-workspace";
import { branchOpsBlockedResponse } from "@/lib/git-tree-branch-ops";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import { destroyBranchWorkspace } from "@/lib/branch-workspace";
import {
  LocalBranchOpError,
  deleteLocalBranch,
  getCurrentLocalBranch,
  renameLocalBranch,
} from "@/lib/project-local-branch-ops";

async function loadProject(id: string) {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

function errorResponse(err: unknown) {
  if (err instanceof LocalBranchOpError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status },
    );
  }
  const message = err instanceof Error ? err.message : "Branch operation failed";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const [branches, currentBranch] = await Promise.all([
    listLocalBranches(project.clonePath),
    getCurrentLocalBranch(project.clonePath),
  ]);

  return NextResponse.json({
    branches,
    currentBranch,
    watchBranch: project.branch,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = (await request.json()) as { branch?: string; force?: boolean };
  const branch = body.branch?.trim() ?? "";
  if (!branch) {
    return NextResponse.json({ error: "Branch is required" }, { status: 400 });
  }

  const blocked = branchOpsBlockedResponse(id);
  if (blocked) return blocked;

  try {
    await deleteLocalBranch(project.clonePath, branch, {
      watchBranch: project.branch,
      force: Boolean(body.force),
    });
    await endAgentAndDestroyBranchWorkspace(id, branch, "branch_deleted");
    invalidateProjectBranches(id);
    return NextResponse.json({
      ok: true,
      deleted: branch,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const blocked = branchOpsBlockedResponse(id);
  if (blocked) return blocked;

  const body = (await request.json()) as { branch?: string; newName?: string };
  const branch = body.branch?.trim() ?? "";
  const newName = body.newName?.trim() ?? "";
  if (!branch || !newName) {
    return NextResponse.json(
      { error: "branch and newName are required" },
      { status: 400 },
    );
  }

  try {
    const renamed = await renameLocalBranch(project.clonePath, branch, newName, {
      watchBranch: project.branch,
    });
    await destroyBranchWorkspace(id, branch);
    const liveSession = getSessionForBranch(id, branch);
    if (liveSession) {
      db.update(agentSessions)
        .set({ branch: renamed })
        .where(eq(agentSessions.id, liveSession.id))
        .run();
    }
    invalidateProjectBranches(id);
    return NextResponse.json({ ok: true, branch: renamed, previous: branch });
  } catch (err) {
    return errorResponse(err);
  }
}
