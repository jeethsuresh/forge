import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { requireProject } from "@/lib/ops-api-route";
import { asTicketError, parseTicketFields, ticketErrorResponse } from "@/lib/ticket-http";
import { getTicketView, updateTicket } from "@/lib/tickets";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, ticketId } = await params;
  if (!requireProject(id)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  try {
    const ticket = getTicketView(ticketId);
    if (ticket.projectId !== id) {
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
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, ticketId } = await params;
  if (!requireProject(id)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const existing = getTicketView(ticketId);
    if (existing.projectId !== id) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    const ticket = updateTicket(ticketId, parseTicketFields(body));
    return NextResponse.json({ ticket });
  } catch (err) {
    const mapped = asTicketError(err);
    if (mapped) {
      return NextResponse.json(
        { error: mapped.message, code: mapped.code },
        { status: mapped.status },
      );
    }
    throw err;
  }
}
