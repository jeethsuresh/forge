import { runOpsTicketAction } from "@/lib/ticket-ops-action";
import { scheduleTicketDrain } from "@/lib/ticket-scheduler";
import { releaseTicket } from "@/lib/tickets";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> },
) {
  return runOpsTicketAction(request, params, "release", ({ ticket }) => {
    const released = releaseTicket(ticket.id);
    scheduleTicketDrain();
    return released;
  });
}
