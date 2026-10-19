import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/ops-api-route";
import { listAllTickets } from "@/lib/tickets";

export async function GET(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const projectId = auth.kind === "session" ? auth.projectId : undefined;
  return NextResponse.json({ tickets: listAllTickets(projectId) });
}
