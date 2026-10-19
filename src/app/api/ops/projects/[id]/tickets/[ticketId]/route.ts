import { NextResponse } from "next/server";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";
import { asTicketError, parseTicketFields, ticketErrorResponse } from "@/lib/ticket-http";
import { getTicketView, updateTicket } from "@/lib/tickets";

function ensureTicketProject(ticketProjectId: string, projectId: string): boolean {
  return ticketProjectId === projectId;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id, ticketId } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  try {
    const ticket = getTicketView(ticketId);
    if (!ensureTicketProject(ticket.projectId, id)) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    return NextResponse.json({ ticket });
  } catch (err) {
    return ticketErrorResponse(err) ?? NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id, ticketId } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const path = `/api/ops/projects/${id}/tickets/${ticketId}`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;
  const fields = parseTicketFields(body);

  try {
    const existing = getTicketView(ticketId);
    if (!ensureTicketProject(existing.projectId, id)) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    const ticket = updateTicket(ticketId, fields);
    return jsonWithAudit(
      { ticket },
      { status: 200 },
      {
        request,
        auth,
        method: "PATCH",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "ticket",
        resourceId: ticketId,
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
        projectId: id,
        resourceType: "ticket",
        resourceId: ticketId,
      });
    }
    throw err;
  }
}
