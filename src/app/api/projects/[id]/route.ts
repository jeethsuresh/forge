import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployments, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { getComposeContainerStatus } from "@/lib/docker";
import { isDeploymentActive } from "@/lib/deployer";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET(
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

  const history = db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, id))
    .orderBy(desc(deployments.startedAt))
    .limit(50)
    .all();

  const currentDeployment =
    history.find((d) => d.status === "success") ?? history[0] ?? null;

  const containers = await getComposeContainerStatus(project.clonePath);

  return NextResponse.json({
    project,
    deployments: history,
    currentDeployment,
    containers,
    isDeploying: isDeploymentActive(id),
  });
}

export async function PATCH(
  request: Request,
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

  const body = (await request.json()) as { enabled?: boolean };
  if (typeof body.enabled === "boolean") {
    db.update(projects)
      .set({ enabled: body.enabled, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .run();
  }

  const updated = db.select().from(projects).where(eq(projects.id, id)).get();
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  db.delete(projects).where(eq(projects.id, id)).run();
  return NextResponse.json({ ok: true });
}
