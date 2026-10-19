import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  projects,
  ticketDependencies,
  tickets,
  type Ticket,
} from "@/lib/db/schema";
import type {
  TicketClaimedByKind,
  TicketRef,
  TicketView,
} from "@/lib/ticket-types";

export type {
  TicketClaimedByKind,
  TicketRef,
  TicketStatus,
  TicketView,
} from "@/lib/ticket-types";

export class TicketError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | "not_found"
      | "not_ready"
      | "claimed"
      | "forbidden"
      | "conflict"
      | "invalid",
  ) {
    super(message);
    this.name = "TicketError";
  }
}

export type TicketClaim = {
  kind: TicketClaimedByKind;
  sessionId?: string | null;
  actor: string;
};

export type TicketCaller = {
  sessionId?: string | null;
  actor?: string | null;
  operator?: boolean;
};

function iso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireTicketRow(ticketId: string): Ticket {
  const row = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
  if (!row) {
    throw new TicketError("Ticket not found", 404, "not_found");
  }
  return row;
}

function requireProjectName(projectId: string): string {
  const project = db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    throw new TicketError("Project not found", 404, "not_found");
  }
  return project.name;
}

function nextProjectNumber(projectId: string): number {
  const last = db
    .select({ number: tickets.number })
    .from(tickets)
    .where(eq(tickets.projectId, projectId))
    .orderBy(desc(tickets.number))
    .get();
  return (last?.number ?? 0) + 1;
}

function nextQueueRank(): number {
  const last = db
    .select({ queueRank: tickets.queueRank })
    .from(tickets)
    .orderBy(desc(tickets.queueRank))
    .get();
  return (last?.queueRank ?? 0) + 1;
}

function dependencyRows(ticketId: string) {
  return db
    .select()
    .from(ticketDependencies)
    .where(eq(ticketDependencies.ticketId, ticketId))
    .all();
}

function followupRows(ticketId: string) {
  return db
    .select()
    .from(ticketDependencies)
    .where(eq(ticketDependencies.dependsOnTicketId, ticketId))
    .all();
}

function ticketRef(row: Ticket): TicketRef {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
  };
}

export function ticketDependsOnIncomplete(ticketId: string): Ticket[] {
  const edges = dependencyRows(ticketId);
  if (edges.length === 0) return [];
  const blockers = db
    .select()
    .from(tickets)
    .where(
      inArray(
        tickets.id,
        edges.map((edge) => edge.dependsOnTicketId),
      ),
    )
    .all();
  return blockers.filter((row) => row.status !== "done");
}

export function isTicketReady(ticketId: string): boolean {
  const row = requireTicketRow(ticketId);
  if (row.status !== "todo" || row.claimedByKind) return false;
  return ticketDependsOnIncomplete(ticketId).length === 0;
}

function wouldCreateCycle(ticketId: string, dependsOnTicketId: string): boolean {
  if (ticketId === dependsOnTicketId) return true;
  const stack = [dependsOnTicketId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === ticketId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of dependencyRows(current)) {
      stack.push(edge.dependsOnTicketId);
    }
  }
  return false;
}

export function addTicketDependency(
  ticketId: string,
  dependsOnTicketId: string,
): void {
  const ticket = requireTicketRow(ticketId);
  const blocker = requireTicketRow(dependsOnTicketId);
  if (ticket.projectId !== blocker.projectId) {
    throw new TicketError(
      "Tickets may only depend on other tickets in the same project",
      400,
      "invalid",
    );
  }
  if (wouldCreateCycle(ticketId, dependsOnTicketId)) {
    throw new TicketError("Dependency would create a cycle", 400, "invalid");
  }
  db.insert(ticketDependencies)
    .values({ ticketId, dependsOnTicketId })
    .run();
}

function toView(row: Ticket, projectName?: string): TicketView {
  const name = projectName ?? requireProjectName(row.projectId);
  const blocked = ticketDependsOnIncomplete(row.id);
  const followupIds = followupRows(row.id).map((edge) => edge.ticketId);
  const followupTickets =
    followupIds.length === 0
      ? []
      : db.select().from(tickets).where(inArray(tickets.id, followupIds)).all();
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: name,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    queueRank: row.queueRank,
    ready: row.status === "todo" && !row.claimedByKind && blocked.length === 0,
    blockedBy: blocked.map(ticketRef),
    followups: followupTickets.map(ticketRef),
    claimedByKind: row.claimedByKind ?? null,
    claimedBySessionId: row.claimedBySessionId ?? null,
    claimedByActor: row.claimedByActor ?? null,
    claimedAt: iso(row.claimedAt),
    branch: row.branch ?? null,
    agentSessionId: row.agentSessionId ?? null,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
    completedAt: iso(row.completedAt),
  };
}

export function ticketBranchName(ticketId: string): string {
  return `ticket/${ticketId.replace(/-/g, "").slice(0, 8)}`;
}

export function getTicketView(ticketId: string): TicketView {
  return toView(requireTicketRow(ticketId));
}

export function listProjectTickets(projectId: string): TicketView[] {
  const name = requireProjectName(projectId);
  return db
    .select()
    .from(tickets)
    .where(eq(tickets.projectId, projectId))
    .orderBy(asc(tickets.number))
    .all()
    .map((row) => toView(row, name));
}

export function listOpenTicketQueue(projectId?: string): TicketView[] {
  const rows = db
    .select()
    .from(tickets)
    .where(
      projectId
        ? and(eq(tickets.projectId, projectId), ne(tickets.status, "done"))
        : ne(tickets.status, "done"),
    )
    .orderBy(asc(tickets.queueRank), asc(tickets.createdAt))
    .all();
  return rows.map((row) => toView(row));
}

export function listAllTickets(projectId?: string): TicketView[] {
  const rows = db
    .select()
    .from(tickets)
    .orderBy(asc(tickets.queueRank), asc(tickets.number))
    .all();
  return rows
    .filter((row) => (projectId ? row.projectId === projectId : true))
    .map((row) => toView(row));
}

export function createTicket(
  projectId: string,
  input: {
    title: string;
    description?: string;
    dependsOnTicketIds?: string[];
  },
): TicketView {
  const title = input.title.trim();
  if (!title) {
    throw new TicketError("Title is required", 400, "invalid");
  }
  requireProjectName(projectId);
  const description = (input.description ?? "").trim();
  const id = randomUUID();
  const now = new Date();

  db.transaction(() => {
    db.insert(tickets)
      .values({
        id,
        projectId,
        number: nextProjectNumber(projectId),
        title,
        description,
        status: "todo",
        queueRank: nextQueueRank(),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const dependsOnTicketId of input.dependsOnTicketIds ?? []) {
      addTicketDependency(id, dependsOnTicketId);
    }
  });

  return getTicketView(id);
}

export function updateTicket(
  ticketId: string,
  input: { title?: string; description?: string },
): TicketView {
  const row = requireTicketRow(ticketId);
  const title =
    input.title === undefined ? row.title : input.title.trim();
  if (!title) {
    throw new TicketError("Title is required", 400, "invalid");
  }
  const description =
    input.description === undefined ? row.description : input.description.trim();
  db.update(tickets)
    .set({ title, description, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId))
    .run();
  return getTicketView(ticketId);
}

export function pickupTicket(ticketId: string, claim: TicketClaim): TicketView {
  db.transaction(() => {
    const row = requireTicketRow(ticketId);
    if (row.status !== "todo" || row.claimedByKind) {
      throw new TicketError("Ticket is already claimed or in progress", 409, "claimed");
    }
    const blocked = ticketDependsOnIncomplete(ticketId);
    if (blocked.length > 0) {
      throw new TicketError(
        `Ticket is blocked by unfinished dependencies: ${blocked
          .map((item) => `#${item.number}`)
          .join(", ")}`,
        409,
        "not_ready",
      );
    }
    db.update(tickets)
      .set({
        status: "in_progress",
        claimedByKind: claim.kind,
        claimedBySessionId: claim.sessionId ?? null,
        claimedByActor: claim.actor,
        claimedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticketId))
      .run();
  });
  return getTicketView(ticketId);
}

function canActAsClaimer(row: Ticket, caller: TicketCaller): boolean {
  if (caller.operator) return true;
  if (caller.sessionId && row.claimedBySessionId === caller.sessionId) {
    return true;
  }
  if (caller.actor && row.claimedByActor === caller.actor) return true;
  return false;
}

export function completeTicket(
  ticketId: string,
  caller: TicketCaller,
): TicketView {
  const row = requireTicketRow(ticketId);
  if (row.status !== "in_progress") {
    throw new TicketError("Only in-progress tickets can be completed", 409, "conflict");
  }
  if (!canActAsClaimer(row, caller)) {
    throw new TicketError("Only the claimer can complete this ticket", 403, "forbidden");
  }
  const now = new Date();
  db.update(tickets)
    .set({
      status: "done",
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(tickets.id, ticketId))
    .run();
  return getTicketView(ticketId);
}

export function releaseTicket(ticketId: string): TicketView {
  const row = requireTicketRow(ticketId);
  if (row.status !== "in_progress") {
    throw new TicketError("Only in-progress tickets can be released", 409, "conflict");
  }
  db.update(tickets)
    .set({
      status: "todo",
      claimedByKind: null,
      claimedBySessionId: null,
      claimedByActor: null,
      claimedAt: null,
      branch: null,
      agentSessionId: null,
      updatedAt: new Date(),
      completedAt: null,
    })
    .where(eq(tickets.id, ticketId))
    .run();
  return getTicketView(ticketId);
}

export function attachTicketSession(
  ticketId: string,
  input: { sessionId: string; branch: string },
): TicketView {
  requireTicketRow(ticketId);
  db.update(tickets)
    .set({
      agentSessionId: input.sessionId,
      claimedBySessionId: input.sessionId,
      branch: input.branch,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticketId))
    .run();
  return getTicketView(ticketId);
}

export function createFollowupTicket(
  parentId: string,
  input: { title: string; description?: string },
): TicketView {
  const parent = requireTicketRow(parentId);
  const followup = createTicket(parent.projectId, {
    title: input.title,
    description: input.description,
    dependsOnTicketIds: [parentId],
  });
  return followup;
}

export function reorderTicketQueue(orderedIds: string[]): TicketView[] {
  const unique = [...new Set(orderedIds)];
  if (unique.length !== orderedIds.length) {
    throw new TicketError("Queue order contains duplicates", 400, "invalid");
  }
  db.transaction(() => {
    unique.forEach((id, index) => {
      const row = requireTicketRow(id);
      if (row.status === "done") {
        throw new TicketError("Done tickets cannot be reordered in the queue", 400, "invalid");
      }
      db.update(tickets)
        .set({ queueRank: index + 1, updatedAt: new Date() })
        .where(eq(tickets.id, id))
        .run();
    });
  });
  return listOpenTicketQueue();
}

export function findNextReadyTicket(projectId?: string): Ticket | null {
  const rows = db
    .select()
    .from(tickets)
    .where(
      projectId
        ? and(eq(tickets.projectId, projectId), eq(tickets.status, "todo"))
        : eq(tickets.status, "todo"),
    )
    .orderBy(asc(tickets.queueRank), asc(tickets.createdAt))
    .all();
  return rows.find((row) => isTicketReady(row.id)) ?? null;
}

export function claimNextTicket(
  claim: TicketClaim,
  projectId?: string,
): TicketView | null {
  const next = findNextReadyTicket(projectId);
  if (!next) return null;
  return pickupTicket(next.id, claim);
}

export function hasInternalTicketWorker(): boolean {
  const row = db
    .select({ id: tickets.id })
    .from(tickets)
    .where(
      and(eq(tickets.status, "in_progress"), eq(tickets.claimedByKind, "internal")),
    )
    .get();
  return Boolean(row);
}

export function listInternalInProgressTickets(): Ticket[] {
  return db
    .select()
    .from(tickets)
    .where(
      and(eq(tickets.status, "in_progress"), eq(tickets.claimedByKind, "internal")),
    )
    .all();
}

export function projectHasInProgressTicket(projectId: string): boolean {
  const row = db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), eq(tickets.status, "in_progress")))
    .get();
  return Boolean(row);
}

export function buildTicketAgentPrompt(view: TicketView): string {
  const blocked =
    view.blockedBy.length === 0
      ? "None."
      : view.blockedBy
          .map((item) => `#${item.number} ${item.title} (${item.status})`)
          .join("\n");
  return `# Ticket #${view.number}: ${view.title}

${view.description || "(No description.)"}

## Dependencies
${blocked}

## Required finish protocol
1. If more work remains after this ticket, create followup tickets first:
   POST /api/ops/projects/${view.projectId}/tickets/${view.id}/followup
   with \`title\`, optional \`description\`, and \`actionDescription\`.
2. When the work for THIS ticket is finished, complete it:
   POST /api/ops/projects/${view.projectId}/tickets/${view.id}/complete
   with \`actionDescription\`.
3. Exiting the agent process does NOT mark the ticket done. You must call complete.
4. Do not pick up other tickets while this one is in progress. A ticket can only be worked by one agent at a time.
`;
}
