import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { isDeploymentActive, runProjectRollback } from "@/lib/deployer";
import { hasRollbackImage, projectSupportsRollback } from "@/lib/deploy-rollback";
import { isForgeProject } from "@/lib/forge-project";
import { startForgeRollback } from "@/lib/self-update";

export async function POST(
  _request: Request,
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
      { error: "A deployment is already in progress for this project" },
      { status: 409 },
    );
  }

  if (isForgeProject(project)) {
    try {
      const updateId = await startForgeRollback();
      return NextResponse.json({ updateId, mode: "forge-self-update" }, { status: 202 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rollback failed";
      return NextResponse.json({ error: message }, { status: 409 });
    }
  }

  if (!projectSupportsRollback(project)) {
    return NextResponse.json(
      { error: "This project does not support rollback" },
      { status: 400 },
    );
  }

  if (!(await hasRollbackImage(project))) {
    return NextResponse.json(
      { error: "No rollback image is available" },
      { status: 409 },
    );
  }

  try {
    const deploymentId = await runProjectRollback(id);
    return NextResponse.json({ deploymentId, mode: "project" }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rollback failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
