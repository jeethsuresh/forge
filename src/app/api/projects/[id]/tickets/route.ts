import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { requireProject } from "@/lib/ops-api-route";
import { asTicketError, parseTicketFields } from "@/lib/ticket-http";
import { scheduleTicketDrain } from "@/lib/ticket-scheduler";
import { createTicket, listProjectTickets } from "@/lib/tickets";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!requireProject(id)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ tickets: listProjectTickets(id) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!requireProject(id)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const fields = parseTicketFields(body);
  const title = fields.title;
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  try {
    const ticket = createTicket(id, {
      title,
      description: fields.description,
      dependsOnTicketIds: fields.dependsOnTicketIds,
    });
    scheduleTicketDrain();
    return NextResponse.json({ ticket }, { status: 201 });
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
