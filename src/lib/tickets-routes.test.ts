import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects, ticketDependencies, tickets } from "@/lib/db/schema";
import { mintSessionOpsToken } from "@/lib/ops-api-auth";
import { setTicketAutoDrainEnabled } from "@/lib/ticket-scheduler";
import { createTicket } from "@/lib/tickets";
import { GET as listProjectTickets } from "@/app/api/ops/projects/[id]/tickets/route";
import { POST as pickupTicketRoute } from "@/app/api/ops/projects/[id]/tickets/[ticketId]/pickup/route";
import { GET as listAllTicketsRoute } from "@/app/api/ops/tickets/route";
import { PATCH as patchQueue } from "@/app/api/ops/tickets/queue/route";

const ACTION = "Picking up a ticket to implement the described work.";

describe("ticket ops routes", () => {
  let projectId: string;
  let otherProjectId: string;
  let sessionId: string;
  let previousToken: string | undefined;
  let previousSecret: string | undefined;

  beforeEach(() => {
    previousToken = process.env.FORGE_OPS_API_TOKEN;
    previousSecret = process.env.FORGE_OPS_SESSION_SECRET;
    process.env.FORGE_OPS_API_TOKEN = "test-global-ops-token";
    process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
    setTicketAutoDrainEnabled(false);

    const now = new Date();
    projectId = randomUUID();
    otherProjectId = randomUUID();
    sessionId = randomUUID();
    for (const [id, name] of [
      [projectId, "Alpha"],
      [otherProjectId, "Beta"],
    ] as const) {
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
    }
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "main",
        status: "running",
        source: "manual",
        initialPrompt: "work",
        logs: "",
        startedAt: now,
      })
      .run();
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.FORGE_OPS_API_TOKEN;
    else process.env.FORGE_OPS_API_TOKEN = previousToken;
    if (previousSecret === undefined) delete process.env.FORGE_OPS_SESSION_SECRET;
    else process.env.FORGE_OPS_SESSION_SECRET = previousSecret;
    setTicketAutoDrainEnabled(true);
    db.delete(ticketDependencies).run();
    db.delete(tickets).run();
    db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    db.delete(projects).where(eq(projects.id, otherProjectId)).run();
  });

  it("lets a session token pick up its project ticket and hides other projects", async () => {
    const own = createTicket(projectId, { title: "Mine" });
    createTicket(otherProjectId, { title: "Theirs" });
    const token = mintSessionOpsToken(sessionId, projectId);

    const list = await listAllTicketsRoute(
      new Request("http://127.0.0.1/api/ops/tickets", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { tickets: { projectId: string }[] };
    expect(listed.tickets.every((row) => row.projectId === projectId)).toBe(true);

    const pickup = await pickupTicketRoute(
      new Request(
        `http://127.0.0.1/api/ops/projects/${projectId}/tickets/${own.id}/pickup`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ actionDescription: ACTION }),
        },
      ),
      { params: Promise.resolve({ id: projectId, ticketId: own.id }) },
    );
    expect(pickup.status).toBe(200);
    const claimed = (await pickup.json()) as { ticket: { status: string } };
    expect(claimed.ticket.status).toBe("in_progress");

    const otherList = await listProjectTickets(
      new Request(`http://127.0.0.1/api/ops/projects/${otherProjectId}/tickets`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: otherProjectId }) },
    );
    expect(otherList.status).toBe(403);

    const reorder = await patchQueue(
      new Request("http://127.0.0.1/api/ops/tickets/queue", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actionDescription: "Reordering the queue from a session token.",
          orderedIds: [own.id],
        }),
      }),
    );
    expect(reorder.status).toBe(403);
  });

  it("allows a global token to reorder the queue", async () => {
    const first = createTicket(projectId, { title: "First" });
    const second = createTicket(projectId, { title: "Second" });
    const reorder = await patchQueue(
      new Request("http://127.0.0.1/api/ops/tickets/queue", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-global-ops-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actionDescription: "Putting second ticket first in the internal queue.",
          orderedIds: [second.id, first.id],
        }),
      }),
    );
    expect(reorder.status).toBe(200);
    const json = (await reorder.json()) as { tickets: { id: string }[] };
    expect(json.tickets.map((row) => row.id)).toEqual([second.id, first.id]);
  });
});
