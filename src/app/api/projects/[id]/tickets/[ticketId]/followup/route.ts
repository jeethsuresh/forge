import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { requireProject } from "@/lib/ops-api-route";
import { asTicketError, parseTicketFields } from "@/lib/ticket-http";
import { scheduleTicketDrain } from "@/lib/ticket-scheduler";
import { createFollowupTicket, getTicketView } from "@/lib/tickets";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, ticketId } = await params;
  if (!requireProject(id)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const fields = parseTicketFields(body);
  if (!fields.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  try {
    const existing = getTicketView(ticketId);
    if (existing.projectId !== id) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    const followup = createFollowupTicket(ticketId, {
      title: fields.title,
      description: fields.description,
    });
    scheduleTicketDrain();
    return NextResponse.json({ ticket: existing, followup }, { status: 201 });
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
