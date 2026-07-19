import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  authenticateOpsRequest,
  isOpsApiConfigured,
  type OpsAuth,
} from "@/lib/ops-api-auth";
import { parseActionDescription, recordOpsAction } from "@/lib/ops-api-actions";

export type { OpsAuth };

export function requireOpsAuth(request: Request): OpsAuth | NextResponse {
  if (!isOpsApiConfigured()) {
    return NextResponse.json(
      { error: "Forge Ops API is not configured" },
      { status: 503 },
    );
  }
  const auth = authenticateOpsRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return auth;
}

export function denyIfWrongProject(
  auth: OpsAuth,
  projectId: string,
): NextResponse | null {
  if (auth.kind === "global") return null;
  if (auth.projectId === projectId) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function resolveOpsActorSessionId(
  auth: OpsAuth,
  request: Request,
): string | null {
  if (auth.kind === "session") return auth.sessionId;
  return request.headers.get("x-forge-agent-session-id")?.trim() || null;
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
  auth?: OpsAuth;
}): string {
  return recordOpsAction({
    actionDescription: input.actionDescription,
    method: input.method,
    path: input.path,
    requestBody: input.requestBody ?? null,
    responseStatus: input.responseStatus,
    projectId: input.projectId ?? null,
    agentSessionId: input.auth
      ? resolveOpsActorSessionId(input.auth, input.request)
      : readAgentSessionHeader(input.request),
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
