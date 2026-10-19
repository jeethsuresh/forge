import { NextResponse } from "next/server";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  requireOpsAuth,
} from "@/lib/ops-api-route";
import { asTicketError } from "@/lib/ticket-http";
import { assertUnrestrictedQueueAuth } from "@/lib/ticket-ops-action";
import { listOpenTicketQueue, reorderTicketQueue } from "@/lib/tickets";

export async function GET(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const projectId = auth.kind === "session" ? auth.projectId : undefined;
  return NextResponse.json({ tickets: listOpenTicketQueue(projectId) });
}

export async function PATCH(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const path = "/api/ops/tickets/queue";
  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;
  const denied = assertUnrestrictedQueueAuth(auth);
  if (denied) {
    return errorWithAudit(
      "Project-scoped session tokens cannot reorder the global ticket queue",
      403,
      {
        request,
        auth,
        method: "PATCH",
        path,
        actionDescription,
        requestBody: body,
        resourceType: "ticket-queue",
      },
    );
  }
  const orderedIds = Array.isArray(body.orderedIds)
    ? body.orderedIds.filter((item): item is string => typeof item === "string")
    : null;
  if (!orderedIds) {
    return errorWithAudit("orderedIds must be an array of ticket ids", 400, {
      request,
      auth,
      method: "PATCH",
      path,
      actionDescription,
      requestBody: body,
      resourceType: "ticket-queue",
    });
  }
  try {
    const tickets = reorderTicketQueue(orderedIds);
    return jsonWithAudit(
      { tickets },
      { status: 200 },
      {
        request,
        auth,
        method: "PATCH",
        path,
        actionDescription,
        requestBody: body,
        resourceType: "ticket-queue",
      },
    );
  } catch (err) {
    const mapped = asTicketError(err);
    if (mapped) {
      return errorWithAudit(mapped.message, mapped.status, {
        request,
        auth,
        method: "PATCH",
        path,
        actionDescription,
        requestBody: body,
        resourceType: "ticket-queue",
      });
    }
    throw err;
  }
}
