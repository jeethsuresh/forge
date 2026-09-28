import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { isUnrestrictedOpsAuth } from "@/lib/ops-api-auth";
import { buildOpsProjectSummary } from "@/lib/ops-api-project";
import {
  createProjectViaOps,
  opsProjectCreateHttpStatus,
} from "@/lib/ops-project-create";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  requireOpsAuth,
} from "@/lib/ops-api-route";

const CREATE_PATH = "/api/ops/projects";

export async function GET(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;

  const allProjects = db.select().from(projects).orderBy(projects.name).all();
  const scoped =
    auth.kind === "session"
      ? allProjects.filter((p) => p.id === auth.projectId)
      : allProjects;
  const summaries = await Promise.all(scoped.map(buildOpsProjectSummary));

  return NextResponse.json({
    projects: summaries,
    search: "/api/ops/search?q=",
    next: [
      {
        method: "GET",
        href: "/api/ops/tools",
        description: "Discover callable project tools",
      },
      {
        method: "POST",
        href: CREATE_PATH,
        description:
          "Create a seeded Forge repo or import GitHub (global or fmu.* tokens)",
      },
    ],
  });
}

export async function POST(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  if (!isUnrestrictedOpsAuth(auth)) {
    return errorWithAudit(
      "Project-scoped session tokens cannot create repositories",
      403,
      {
        request,
        auth,
        method: "POST",
        path: CREATE_PATH,
        actionDescription,
        requestBody: body,
        resourceType: "project",
      },
    );
  }

  try {
    const created = await createProjectViaOps({
      mode: typeof body.mode === "string" ? body.mode : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
      slug: typeof body.slug === "string" ? body.slug : undefined,
      branch: typeof body.branch === "string" ? body.branch : undefined,
      githubRepo:
        typeof body.githubRepo === "string" ? body.githubRepo : undefined,
    });
    return jsonWithAudit(
      { ok: true, ...created },
      { status: 201 },
      {
        request,
        auth,
        method: "POST",
        path: CREATE_PATH,
        actionDescription,
        requestBody: body,
        projectId: created.projectId,
        resourceType: "project",
        resourceId: created.projectId,
      },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create project";
    return errorWithAudit(message, opsProjectCreateHttpStatus(message), {
      request,
      auth,
      method: "POST",
      path: CREATE_PATH,
      actionDescription,
      requestBody: body,
      resourceType: "project",
    });
  }
}
