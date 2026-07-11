import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { isOpsApiConfigured, verifyOpsApiToken } from "@/lib/ops-api-auth";
import { parseActionDescription, recordOpsAction } from "@/lib/ops-api-actions";

export function opsAuthErrorResponse(): NextResponse | null {
  if (!isOpsApiConfigured()) {
    return NextResponse.json(
      { error: "Forge Ops API is not configured (set FORGE_OPS_API_TOKEN)" },
      { status: 503 },
    );
  }
  return null;
}

export function requireOpsAuth(request: Request): NextResponse | null {
  const configError = opsAuthErrorResponse();
  if (configError) return configError;
  if (!verifyOpsApiToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function readAgentSessionHeader(request: Request): string | null {
  return request.headers.get("x-forge-agent-session-id")?.trim() || null;
}

export function requireProject(projectId: string) {
  return db.select().from(projects).where(eq(projects.id, projectId)).get();
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

export function requireActionDescription(
  body: Record<string, unknown>,
): { actionDescription: string } | NextResponse {
  const parsed = parseActionDescription(body);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  return { actionDescription: parsed.actionDescription };
}

export function auditOpsAction(input: {
  request: Request;
  method: string;
  path: string;
  actionDescription: string;
  requestBody?: Record<string, unknown> | null;
  responseStatus: number;
  projectId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
}): string {
  return recordOpsAction({
    actionDescription: input.actionDescription,
    method: input.method,
    path: input.path,
    requestBody: input.requestBody ?? null,
    responseStatus: input.responseStatus,
    projectId: input.projectId ?? null,
    agentSessionId: readAgentSessionHeader(input.request),
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
  });
}

export function jsonWithAudit(
  payload: unknown,
  init: { status: number },
  audit: Omit<Parameters<typeof auditOpsAction>[0], "responseStatus">,
): NextResponse {
  const actionId = auditOpsAction({ ...audit, responseStatus: init.status });
  const body =
    payload && typeof payload === "object"
      ? { ...(payload as Record<string, unknown>), opsActionId: actionId }
      : { result: payload, opsActionId: actionId };
  return NextResponse.json(body, init);
}

export function errorWithAudit(
  error: string,
  status: number,
  audit: Omit<Parameters<typeof auditOpsAction>[0], "responseStatus" | "requestBody"> & {
    requestBody?: Record<string, unknown> | null;
  },
): NextResponse {
  const actionId = auditOpsAction({ ...audit, responseStatus: status });
  return NextResponse.json({ error, opsActionId: actionId }, { status });
}
