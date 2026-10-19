import { NextResponse } from "next/server";
import { isUnrestrictedOpsAuth, type OpsAuth } from "@/lib/ops-api-auth";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";
import { asTicketError } from "@/lib/ticket-http";
import { getTicketView, type TicketView } from "@/lib/tickets";

export async function runOpsTicketAction(
  request: Request,
  params: Promise<{ id: string; ticketId: string }>,
  action: string,
  mutate: (input: {
    auth: OpsAuth;
    body: Record<string, unknown>;
    ticket: TicketView;
  }) => TicketView | { ticket: TicketView; followup?: TicketView },
): Promise<NextResponse> {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id, ticketId } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const path = `/api/ops/projects/${id}/tickets/${ticketId}/${action}`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  try {
    const existing = getTicketView(ticketId);
    if (existing.projectId !== id) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    const result = mutate({ auth, body, ticket: existing });
    const payload =
      "followup" in result || "ticket" in result
        ? result
        : { ticket: result };
    const ticketIdForAudit =
      "ticket" in payload ? payload.ticket.id : existing.id;
    return jsonWithAudit(payload, { status: 200 }, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "ticket",
      resourceId: ticketIdForAudit,
    });
  } catch (err) {
    const mapped = asTicketError(err);
    if (mapped) {
      return errorWithAudit(mapped.message, mapped.status, {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "ticket",
        resourceId: ticketId,
      });
    }
    throw err;
  }
}

export function assertUnrestrictedQueueAuth(auth: OpsAuth): NextResponse | null {
  if (isUnrestrictedOpsAuth(auth)) return null;
  return NextResponse.json(
    { error: "Project-scoped session tokens cannot reorder the global ticket queue" },
    { status: 403 },
  );
}
