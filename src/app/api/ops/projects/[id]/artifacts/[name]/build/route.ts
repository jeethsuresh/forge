import { NextResponse } from "next/server";
import { buildArtifact, getArtifactBuild } from "@/lib/artifact-build";
import { serializeArtifactBuild } from "@/lib/artifact-api";
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

  const artifactName = decodeURIComponent(name).trim();
  const path = `/api/ops/projects/${id}/artifacts/${encodeURIComponent(artifactName)}/build`;

  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  if (!artifactName) {
    return errorWithAudit("Artifact name is required", 400, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "artifact",
    });
  }

  const branch =
    typeof body.branch === "string" && body.branch.trim()
      ? body.branch.trim()
      : undefined;

  try {
    const buildId = await buildArtifact(id, artifactName, { branch });
    const build = getArtifactBuild(buildId);
    return jsonWithAudit(
      {
        ok: true,
        buildId,
        build: build ? serializeArtifactBuild(build) : null,
      },
      { status: build?.status === "failed" ? 409 : 200 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "artifact",
        resourceId: buildId,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Artifact build failed";
    const status = /Forgefile|not declared|not found/i.test(message) ? 409 : 500;
    return errorWithAudit(message, status, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "artifact",
      resourceId: artifactName,
    });
  }
}
