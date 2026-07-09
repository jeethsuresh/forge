import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  createAgentSession,
  getBranchAgentOverview,
  listAgentSessionsForClient,
} from "@/lib/agent-runner";
import {
  reconcileAbandonedDeployingSessions,
  reconcileInterruptedDeployments,
} from "@/lib/deploy-reconcile";
import { getActiveSessionForProject, isAgentSessionActive } from "@/lib/agent-state";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  reconcileInterruptedDeployments(id);
  reconcileAbandonedDeployingSessions(id);

  const sessions = listAgentSessionsForClient(id);
  const activeSession = getActiveSessionForProject(id);
  const branches = await getBranchAgentOverview(id);

  return NextResponse.json({
    sessions,
    branches,
    activeSession: activeSession ?? null,
    hasActiveSession: isAgentSessionActive(id),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = (await request.json()) as { prompt?: string; branch?: string };
  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }
  if (!body.branch?.trim()) {
    return NextResponse.json({ error: "Branch is required" }, { status: 400 });
  }

  try {
    const sessionId = await createAgentSession(
      id,
      body.branch.trim(),
      body.prompt.trim(),
    );
    return NextResponse.json({ sessionId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    const status = message.includes("already active") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
