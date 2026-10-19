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
import { asTicketError, parseTicketFields } from "@/lib/ticket-http";
import { scheduleTicketDrain } from "@/lib/ticket-scheduler";
import { createTicket, listProjectTickets } from "@/lib/tickets";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ tickets: listProjectTickets(id) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const path = `/api/ops/projects/${id}/tickets`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;
  const fields = parseTicketFields(body);
  const title = fields.title;
  if (!title) {
    return errorWithAudit("title is required", 400, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "ticket",
    });
  }

  try {
    const ticket = createTicket(id, {
      title,
      description: fields.description,
      dependsOnTicketIds: fields.dependsOnTicketIds,
    });
    scheduleTicketDrain();
    return jsonWithAudit(
      { ticket },
      { status: 201 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "ticket",
        resourceId: ticket.id,
      },
    );
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
      });
    }
    throw err;
  }
}
