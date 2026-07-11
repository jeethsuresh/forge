import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { existsSync } from "fs";
import { join } from "path";
import { getSession } from "@/lib/auth/session";
import { stopComposeProject } from "@/lib/docker";
import { isDeploymentActive } from "@/lib/deployer";
import { runScript } from "@/lib/github";
import { resolveClonePath } from "@/lib/paths";
import { buildProjectScriptEnv, projectScriptArgs } from "@/lib/projects";

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
    const repoPath = resolveClonePath(project.clonePath);
    const { env: scriptEnv, composeProjectName: composeSlug } =
      buildProjectScriptEnv(project.name, project.deployEnvJson, project.hostPort);
    const scriptArgs = projectScriptArgs(composeSlug, scriptEnv);
    const teardownPath = join(repoPath, "teardown.sh");
    if (existsSync(teardownPath)) {
      const lines: string[] = [];
      await runScript("teardown.sh", repoPath, (line) => lines.push(line), {
        env: scriptEnv,
        args: scriptArgs,
      });
      return NextResponse.json({ ok: true, output: lines.join("\n") });
    }

    const output = await stopComposeProject(repoPath, composeSlug);
    return NextResponse.json({ ok: true, output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stop failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
