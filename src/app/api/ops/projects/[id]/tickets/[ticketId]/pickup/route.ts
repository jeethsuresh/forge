import { opsTicketClaim } from "@/lib/ticket-http";
import { runOpsTicketAction } from "@/lib/ticket-ops-action";
import { scheduleTicketDrain } from "@/lib/ticket-scheduler";
import { pickupTicket } from "@/lib/tickets";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> },
) {
  return runOpsTicketAction(request, params, "pickup", ({ auth, ticket }) => {
    const claimed = pickupTicket(ticket.id, opsTicketClaim(auth, request));
    scheduleTicketDrain();
    return claimed;
  });
}
