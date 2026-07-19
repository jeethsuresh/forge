import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { isDeploymentActive } from "@/lib/deployer";
import { stopComposeProject } from "@/lib/docker";
import { runScript } from "@/lib/github";
import { resolveClonePath } from "@/lib/paths";
import { buildProjectScriptEnv, projectScriptArgs } from "@/lib/projects";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const path = `/api/ops/projects/${id}/stop`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  if (isDeploymentActive(id)) {
    return errorWithAudit(
      "Cannot stop while a deployment is in progress",
      409,
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "stop",
      },
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
      return jsonWithAudit(
        { ok: true, output: lines.join("\n") },
        { status: 200 },
        {
          request,
          auth,
          method: "POST",
          path,
          actionDescription,
          requestBody: body,
          projectId: id,
          resourceType: "stop",
        },
      );
    }

    const output = await stopComposeProject(repoPath, composeSlug);
    return jsonWithAudit(
      { ok: true, output },
      { status: 200 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "stop",
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stop failed";
    return errorWithAudit(message, 500, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "stop",
    });
  }
}
