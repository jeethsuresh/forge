import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { commitAgentSessionChanges, getAgentSession } from "@/lib/agent-runner";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, sessionId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const agentSession = getAgentSession(sessionId);
  if (!agentSession || agentSession.projectId !== id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let message: string | undefined;
  try {
    const body = (await request.json()) as { message?: string };
    message = body.message?.trim();
  } catch {
    // optional body
  }

  try {
    const result = await commitAgentSessionChanges(sessionId, { message });
    return NextResponse.json(result);
  } catch (err) {
    const errMessage =
      err instanceof Error ? err.message : "Failed to commit changes";
    return NextResponse.json({ error: errMessage }, { status: 409 });
  }
}
