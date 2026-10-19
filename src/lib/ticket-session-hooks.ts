type TicketSessionTerminalHandler = (sessionId: string) => void;

let ticketSessionTerminalHandler: TicketSessionTerminalHandler | null = null;

export function setTicketSessionTerminalHandler(
  handler: TicketSessionTerminalHandler | null,
): void {
  ticketSessionTerminalHandler = handler;
}

export function notifyTicketSessionTerminal(sessionId: string): void {
  ticketSessionTerminalHandler?.(sessionId);
}
