import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { setTicketSessionTerminalHandler } from "@/lib/ticket-session-hooks";
import {
  attachTicketSession,
  buildTicketAgentPrompt,
  findNextReadyTicket,
  hasInternalTicketWorker,
  listInternalInProgressTickets,
  pickupTicket,
  releaseTicket,
  ticketBranchName,
  type TicketView,
} from "@/lib/tickets";

const LIVE_SESSION_STATUSES = new Set(["pending", "running", "deploying"]);
const SPAWN_GRACE_MS = 60_000;

export type TicketSessionSpawnInput = {
  projectId: string;
  branch: string;
  prompt: string;
  ticketId: string;
};

export type TicketSessionSpawner = (
  input: TicketSessionSpawnInput,
) => Promise<{ sessionId: string }>;

let ticketSessionSpawner: TicketSessionSpawner | null = null;
let draining = false;
let autoDrainEnabled = true;

export function setTicketSessionSpawner(spawner: TicketSessionSpawner | null): void {
  ticketSessionSpawner = spawner;
}

export function setTicketAutoDrainEnabled(enabled: boolean): void {
  autoDrainEnabled = enabled;
}

function sessionIsLive(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
  if (!session || session.archivedAt) return false;
  return LIVE_SESSION_STATUSES.has(session.status);
}

export function reconcileInternalTicketClaims(): void {
  const now = Date.now();
  for (const ticket of listInternalInProgressTickets()) {
    if (sessionIsLive(ticket.agentSessionId)) continue;
    if (!ticket.agentSessionId && ticket.claimedAt) {
      const claimedAt =
        ticket.claimedAt instanceof Date
          ? ticket.claimedAt.getTime()
          : new Date(ticket.claimedAt).getTime();
      if (now - claimedAt < SPAWN_GRACE_MS) continue;
    }
    releaseTicket(ticket.id);
  }
}

async function defaultSpawn(
  input: TicketSessionSpawnInput,
): Promise<{ sessionId: string }> {
  const { createAgentSession } = await import("@/lib/agent-runner");
  const { sessionId } = await createAgentSession(
    input.projectId,
    input.branch,
    input.prompt,
    { source: "ticket", ticketId: input.ticketId },
  );
  return { sessionId };
}

export async function drainTicketScheduler(): Promise<TicketView | null> {
  if (draining) return null;
  draining = true;
  try {
    reconcileInternalTicketClaims();
    if (hasInternalTicketWorker()) return null;
    const next = findNextReadyTicket();
    if (!next) return null;
    const claimed = pickupTicket(next.id, {
      kind: "internal",
      actor: "internal",
    });
    const branch = ticketBranchName(claimed.id);
    const prompt = buildTicketAgentPrompt(claimed);
    try {
      const spawn = ticketSessionSpawner ?? defaultSpawn;
      const { sessionId } = await spawn({
        projectId: claimed.projectId,
        branch,
        prompt,
        ticketId: claimed.id,
      });
      return attachTicketSession(claimed.id, { sessionId, branch });
    } catch (err) {
      releaseTicket(claimed.id);
      throw err;
    }
  } finally {
    draining = false;
  }
}

export function scheduleTicketDrain(): void {
  if (!autoDrainEnabled) return;
  void drainTicketScheduler().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[forge] ticket scheduler failed: ${message}`);
  });
}

export async function handleTicketSessionTerminal(
  sessionId: string,
): Promise<TicketView | null> {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
  if (!session?.ticketId) return null;
  const internals = listInternalInProgressTickets();
  const claimed = internals.find(
    (ticket) =>
      ticket.id === session.ticketId || ticket.agentSessionId === sessionId,
  );
  if (claimed) {
    releaseTicket(claimed.id);
  }
  return drainTicketScheduler();
}

export function onTicketSessionTerminal(sessionId: string): void {
  void handleTicketSessionTerminal(sessionId).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[forge] ticket session terminal handler failed: ${message}`);
  });
}

setTicketSessionTerminalHandler(onTicketSessionTerminal);
