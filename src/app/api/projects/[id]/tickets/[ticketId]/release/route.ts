import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { requireProject } from "@/lib/ops-api-route";
import { asTicketError } from "@/lib/ticket-http";
import { scheduleTicketDrain } from "@/lib/ticket-scheduler";
import { getTicketView, releaseTicket } from "@/lib/tickets";

export async function POST(
  _request: Request,
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
  try {
    const existing = getTicketView(ticketId);
    if (existing.projectId !== id) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    const ticket = releaseTicket(ticketId);
    scheduleTicketDrain();
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
