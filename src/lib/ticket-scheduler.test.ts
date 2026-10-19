import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects, ticketDependencies, tickets } from "@/lib/db/schema";
import { createTicket, getTicketView, pickupTicket } from "@/lib/tickets";
import {
  drainTicketScheduler,
  handleTicketSessionTerminal,
  reconcileInternalTicketClaims,
  setTicketSessionSpawner,
} from "@/lib/ticket-scheduler";

function seedProject(): string {
  const id = randomUUID();
  const now = new Date();
  db.insert(projects)
    .values({
      id,
      name: "queue",
      githubRepo: "",
      branch: "main",
      clonePath: `/tmp/${id}`,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

describe("ticket scheduler", () => {
  let projectId: string;
  let spawned: { ticketId: string; branch: string; prompt: string }[];

  beforeEach(() => {
    projectId = seedProject();
    spawned = [];
    setTicketSessionSpawner(async (input) => {
      spawned.push({
        ticketId: input.ticketId,
        branch: input.branch,
        prompt: input.prompt,
      });
      const existing = db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.projectId, input.projectId))
        .all()
        .find((row) => row.branch === input.branch && !row.archivedAt);
      if (existing) {
        db.update(agentSessions)
          .set({
            status: "running",
            source: "ticket",
            ticketId: input.ticketId,
            initialPrompt: input.prompt,
          })
          .where(eq(agentSessions.id, existing.id))
          .run();
        return { sessionId: existing.id };
      }
      const sessionId = randomUUID();
      db.insert(agentSessions)
        .values({
          id: sessionId,
          projectId: input.projectId,
          branch: input.branch,
          status: "running",
          source: "ticket",
          ticketId: input.ticketId,
          initialPrompt: input.prompt,
          logs: "",
          startedAt: new Date(),
        })
        .run();
      return { sessionId };
    });
  });

  afterEach(() => {
    setTicketSessionSpawner(null);
    db.delete(ticketDependencies).run();
    db.delete(tickets).where(eq(tickets.projectId, projectId)).run();
    db.delete(agentSessions).where(eq(agentSessions.projectId, projectId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("spawns one internal session for the next ready ticket", async () => {
    const first = createTicket(projectId, { title: "First" });
    createTicket(projectId, { title: "Second" });

    const started = await drainTicketScheduler();
    expect(started?.id).toBe(first.id);
    expect(started?.status).toBe("in_progress");
    expect(started?.claimedByKind).toBe("internal");
    expect(started?.agentSessionId).toBeTruthy();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.prompt).toContain("Ticket #1: First");

    const skipped = await drainTicketScheduler();
    expect(skipped).toBeNull();
    expect(spawned).toHaveLength(1);
  });

  it("skips blocked and ops-claimed tickets", async () => {
    const blocker = createTicket(projectId, { title: "Blocker" });
    createTicket(projectId, {
      title: "Blocked",
      dependsOnTicketIds: [blocker.id],
    });
    pickupTicket(blocker.id, { kind: "ops", actor: "functional:bot" });
    const ready = createTicket(projectId, { title: "Ready" });

    const started = await drainTicketScheduler();
    expect(started?.id).toBe(ready.id);
  });

  it("releases a ticket when its session ends without complete, then retries it", async () => {
    const first = createTicket(projectId, { title: "First" });
    createTicket(projectId, { title: "Second" });
    const started = await drainTicketScheduler();
    expect(started?.id).toBe(first.id);
    const sessionId = started?.agentSessionId;
    expect(sessionId).toBeTruthy();

    db.update(agentSessions)
      .set({ status: "failed" })
      .where(eq(agentSessions.id, sessionId!))
      .run();

    const retried = await handleTicketSessionTerminal(sessionId!);

    expect(getTicketView(first.id).status).toBe("in_progress");
    expect(retried?.id).toBe(first.id);
    expect(spawned).toHaveLength(2);
  });

  it("releases orphan internal claims whose session is gone", () => {
    const created = createTicket(projectId, { title: "Orphan" });
    pickupTicket(created.id, { kind: "internal", actor: "internal" });
    db.update(tickets)
      .set({
        claimedAt: new Date(Date.now() - 5 * 60_000),
        agentSessionId: null,
      })
      .where(eq(tickets.id, created.id))
      .run();

    reconcileInternalTicketClaims();
    expect(getTicketView(created.id).status).toBe("todo");
  });
});
