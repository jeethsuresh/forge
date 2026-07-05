import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { getSession } from "@/lib/auth/session";
import { stopComposeProject } from "@/lib/docker";
import { isDeploymentActive } from "@/lib/deployer";
import { runScript } from "@/lib/github";

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
    const teardownPath = join(resolve(project.clonePath), "teardown.sh");
    if (existsSync(teardownPath)) {
      const lines: string[] = [];
      await runScript("teardown.sh", project.clonePath, (line) => lines.push(line));
      return NextResponse.json({ ok: true, output: lines.join("\n") });
    }

    const output = await stopComposeProject(project.clonePath);
    return NextResponse.json({ ok: true, output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stop failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
