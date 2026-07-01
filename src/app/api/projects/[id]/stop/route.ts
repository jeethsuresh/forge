import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { stopComposeProject } from "@/lib/docker";
import { isDeploymentActive } from "@/lib/deployer";

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
      { error: "Cannot stop while a deployment is in progress" },
      { status: 409 },
    );
  }

  try {
    const output = await stopComposeProject(project.clonePath);
    return NextResponse.json({ ok: true, output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stop failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
