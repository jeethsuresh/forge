import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { regenerateGitCloneToken } from "@/lib/git-clone-token";
import { GIT_HTTPS_BASIC_USERNAME } from "@/lib/git-https-auth";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.gitRepositoryId) {
    return NextResponse.json(
      { error: "Project has no Forge git repository" },
      { status: 400 },
    );
  }

  try {
    const gitCloneToken = regenerateGitCloneToken(project.gitRepositoryId);
    return NextResponse.json({
      gitCloneUsername: GIT_HTTPS_BASIC_USERNAME,
      gitCloneToken,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to regenerate clone token";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
