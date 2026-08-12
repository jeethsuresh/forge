import { NextResponse } from "next/server";
import { runNamedProjectScript } from "@/lib/forgefile-run";
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
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id, name } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const scriptName = decodeURIComponent(name).trim();
  const path = `/api/ops/projects/${id}/scripts/${encodeURIComponent(scriptName)}/run`;

  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  if (!scriptName) {
    return errorWithAudit("Script name is required", 400, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "script",
    });
  }

  try {
    const lines: string[] = [];
    await runNamedProjectScript(id, scriptName, (line) => lines.push(line));
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
        resourceType: "script",
        resourceId: scriptName,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Script run failed";
    const status = /Forgefile|not defined|not found/i.test(message) ? 409 : 500;
    return errorWithAudit(message, status, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "script",
      resourceId: scriptName,
    });
  }
}
