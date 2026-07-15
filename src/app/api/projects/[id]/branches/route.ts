import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  createAgentBranch,
  createAgentSession,
} from "@/lib/agent-runner";
import { validateBranchName } from "@/lib/github";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = (await request.json()) as { name?: string; prompt?: string };
  const branchName = body.name?.trim() ?? "";
  const prompt = body.prompt?.trim() ?? "";

  const validationError = validateBranchName(branchName);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  try {
    await createAgentBranch(id, branchName);
    const { sessionId, queued } = await createAgentSession(id, branchName, prompt);
    return NextResponse.json({ branch: branchName, sessionId, queued }, { status: queued ? 202 : 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create branch";
    const status = message.includes("already active") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
