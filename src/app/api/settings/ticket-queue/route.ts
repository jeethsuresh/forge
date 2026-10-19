import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { asTicketError } from "@/lib/ticket-http";
import { listOpenTicketQueue, reorderTicketQueue } from "@/lib/tickets";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ tickets: listOpenTicketQueue() });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orderedIds = Array.isArray(body.orderedIds)
    ? body.orderedIds.filter((item): item is string => typeof item === "string")
    : null;
  if (!orderedIds) {
    return NextResponse.json(
      { error: "orderedIds must be an array of ticket ids" },
      { status: 400 },
    );
  }
  try {
    const tickets = reorderTicketQueue(orderedIds);
    return NextResponse.json({ tickets });
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
