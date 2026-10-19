import { opsTicketCaller } from "@/lib/ticket-http";
import { runOpsTicketAction } from "@/lib/ticket-ops-action";
import { scheduleTicketDrain } from "@/lib/ticket-scheduler";
import { completeTicket } from "@/lib/tickets";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> },
) {
  return runOpsTicketAction(request, params, "complete", ({ auth, ticket }) => {
    const done = completeTicket(ticket.id, opsTicketCaller(auth, request));
    scheduleTicketDrain();
    return done;
  });
}
