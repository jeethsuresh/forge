import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects as projectsTable } from "@/lib/db/schema";
import { buildOpsProjectDetail } from "@/lib/ops-api-project";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";
import {
  normalizeProjectRoutingUpdates,
  validateProjectRoutingInput,
} from "@/lib/project-routing";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(await buildOpsProjectDetail(project));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const path = `/api/ops/projects/${id}`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  const updates: {
    enabled?: boolean;
    hostPort?: number | null;
    updatedAt?: Date;
  } = {};

  if (typeof body.enabled === "boolean") {
    updates.enabled = body.enabled;
  }

  if (body.hostPort !== undefined) {
    const routingError = validateProjectRoutingInput({
      hostPort: body.hostPort as number | null,
      projectId: id,
    });
    if (routingError) {
      return errorWithAudit(routingError, 400, {
        request,
        method: "PATCH",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "project",
        resourceId: id,
      });
    }
    const normalized = normalizeProjectRoutingUpdates(project, {
      hostPort: body.hostPort as number | null,
    });
    updates.hostPort = normalized.hostPort;
  }

  if (Object.keys(updates).length === 0) {
    return errorWithAudit(
      "No supported config fields provided (enabled, hostPort)",
      400,
      {
        request,
        method: "PATCH",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "project",
        resourceId: id,
      },
    );
  }

  db.update(projectsTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(projectsTable.id, id))
    .run();

  const updated = requireProject(id);
  return jsonWithAudit(
    { project: updated, updatedFields: Object.keys(updates) },
    { status: 200 },
    {
      request,
      method: "PATCH",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "project",
      resourceId: id,
    },
  );
}
