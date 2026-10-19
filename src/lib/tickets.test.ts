import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTicketAutoDrainEnabled } from "@/lib/ticket-scheduler";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, ticketDependencies, tickets } from "@/lib/db/schema";
import {
  TicketError,
  addTicketDependency,
  claimNextTicket,
  completeTicket,
  createFollowupTicket,
  createTicket,
  getTicketView,
  isTicketReady,
  listOpenTicketQueue,
  listProjectTickets,
  pickupTicket,
  releaseTicket,
  reorderTicketQueue,
  ticketBranchName,
  updateTicket,
} from "@/lib/tickets";

function seedProject(name = "demo"): string {
  const id = randomUUID();
  const now = new Date();
  db.insert(projects)
    .values({
      id,
      name,
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

function cleanup(projectIds: string[]) {
  for (const projectId of projectIds) {
    db.delete(ticketDependencies).run();
    db.delete(tickets).where(eq(tickets.projectId, projectId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  }
}

describe("tickets", () => {
  let projectId: string;
  let otherProjectId: string;

  beforeEach(() => {
    setTicketAutoDrainEnabled(false);
    projectId = seedProject("alpha");
    otherProjectId = seedProject("beta");
  });

  afterEach(() => {
    cleanup([projectId, otherProjectId]);
    setTicketAutoDrainEnabled(true);
  });

  it("creates a numbered todo ticket at the end of the global queue", () => {
    const first = createTicket(projectId, { title: "One", description: "a" });
    const second = createTicket(projectId, { title: "Two" });

    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
    expect(first.status).toBe("todo");
    expect(first.ready).toBe(true);
    expect(first.description).toBe("a");
    expect(second.description).toBe("");
    expect(second.queueRank).toBeGreaterThan(first.queueRank);
    expect(ticketBranchName(first.id)).toMatch(/^ticket\/[a-f0-9]{8}$/);
  });

  it("rejects an empty title", () => {
    expect(() => createTicket(projectId, { title: "  " })).toThrow(TicketError);
  });

  it("picks up a ready ticket exclusively", () => {
    const created = createTicket(projectId, { title: "Work" });
    const claimed = pickupTicket(created.id, {
      kind: "ops",
      sessionId: "sess-1",
      actor: "session:sess-1",
    });

    expect(claimed.status).toBe("in_progress");
    expect(claimed.claimedByKind).toBe("ops");
    expect(claimed.claimedBySessionId).toBe("sess-1");
    expect(claimed.ready).toBe(false);

    expect(() =>
      pickupTicket(created.id, {
        kind: "ops",
        sessionId: "sess-2",
        actor: "session:sess-2",
      }),
    ).toThrow(/claimed|in progress/i);
  });

  it("does not start a ticket until every dependency is done", () => {
    const blocker = createTicket(projectId, { title: "Blocker" });
    const waiting = createTicket(projectId, {
      title: "Waiting",
      dependsOnTicketIds: [blocker.id],
    });

    expect(isTicketReady(waiting.id)).toBe(false);
    expect(getTicketView(waiting.id).blockedBy.map((row) => row.id)).toEqual([
      blocker.id,
    ]);

    expect(() =>
      pickupTicket(waiting.id, { kind: "internal", actor: "internal" }),
    ).toThrow(/depend/i);

    pickupTicket(blocker.id, { kind: "internal", actor: "internal" });
    completeTicket(blocker.id, { operator: true });

    expect(isTicketReady(waiting.id)).toBe(true);
    const claimed = pickupTicket(waiting.id, {
      kind: "internal",
      actor: "internal",
    });
    expect(claimed.status).toBe("in_progress");
  });

  it("rejects dependency cycles and cross-project edges", () => {
    const a = createTicket(projectId, { title: "A" });
    const b = createTicket(projectId, {
      title: "B",
      dependsOnTicketIds: [a.id],
    });
    expect(() => addTicketDependency(a.id, b.id)).toThrow(/cycle/i);
    expect(() => addTicketDependency(a.id, a.id)).toThrow(/cycle/i);

    const foreign = createTicket(otherProjectId, { title: "Other" });
    expect(() =>
      createTicket(projectId, {
        title: "cross",
        dependsOnTicketIds: [foreign.id],
      }),
    ).toThrow(/same project/i);

    expect(() =>
      createTicket(projectId, {
        title: "self",
        dependsOnTicketIds: ["nope"],
      }),
    ).toThrow(TicketError);
  });

  it("creates a followup that waits on the parent, then allows complete", () => {
    const parent = createTicket(projectId, { title: "Parent" });
    pickupTicket(parent.id, { kind: "ops", sessionId: "s", actor: "session:s" });
    const followup = createFollowupTicket(parent.id, {
      title: "Followup",
      description: "more",
    });

    expect(followup.ready).toBe(false);
    expect(followup.blockedBy[0]?.id).toBe(parent.id);
    expect(getTicketView(parent.id).followups[0]?.id).toBe(followup.id);

    const done = completeTicket(parent.id, { sessionId: "s" });
    expect(done.status).toBe("done");
    expect(isTicketReady(followup.id)).toBe(true);
  });

  it("releases a stuck in-progress ticket back to todo", () => {
    const created = createTicket(projectId, { title: "Stuck" });
    pickupTicket(created.id, { kind: "internal", actor: "internal" });
    const released = releaseTicket(created.id);
    expect(released.status).toBe("todo");
    expect(released.claimedByKind).toBeNull();
    expect(released.agentSessionId).toBeNull();
  });

  it("reorders the open queue and claim-next respects rank and skips blocked/claimed", () => {
    const first = createTicket(projectId, { title: "First" });
    const second = createTicket(projectId, { title: "Second" });
    const blocker = createTicket(projectId, { title: "Blocker" });
    const blocked = createTicket(projectId, {
      title: "Blocked",
      dependsOnTicketIds: [blocker.id],
    });

    reorderTicketQueue([second.id, first.id, blocker.id, blocked.id]);
    pickupTicket(second.id, { kind: "ops", actor: "functional:bot" });

    const next = claimNextTicket({ kind: "internal", actor: "internal" });
    expect(next?.id).toBe(first.id);

    const queue = listOpenTicketQueue();
    expect(queue.map((row) => row.id)).toEqual([
      second.id,
      first.id,
      blocker.id,
      blocked.id,
    ]);
    expect(listProjectTickets(projectId)).toHaveLength(4);
  });

  it("lets operators complete and rejects a different session", () => {
    const created = createTicket(projectId, { title: "Auth" });
    pickupTicket(created.id, {
      kind: "ops",
      sessionId: "owner",
      actor: "session:owner",
    });
    expect(() => completeTicket(created.id, { sessionId: "other" })).toThrow(
      /claimer|forbidden/i,
    );
    const done = completeTicket(created.id, { operator: true });
    expect(done.status).toBe("done");
    expect(done.claimedBySessionId).toBe("owner");
  });

  it("updates title and description on a todo ticket", () => {
    const created = createTicket(projectId, { title: "Old" });
    const updated = updateTicket(created.id, {
      title: "New",
      description: "body",
    });
    expect(updated.title).toBe("New");
    expect(updated.description).toBe("body");
  });
});
