import { parseTicketFields } from "@/lib/ticket-http";
import { runOpsTicketAction } from "@/lib/ticket-ops-action";
import { scheduleTicketDrain } from "@/lib/ticket-scheduler";
import { TicketError, createFollowupTicket } from "@/lib/tickets";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> },
) {
  return runOpsTicketAction(request, params, "followup", ({ body, ticket }) => {
    const fields = parseTicketFields(body);
    if (!fields.title) {
      throw new TicketError("title is required", 400, "invalid");
    }
    const followup = createFollowupTicket(ticket.id, {
      title: fields.title,
      description: fields.description,
    });
    scheduleTicketDrain();
    return { ticket, followup };
  });
}
