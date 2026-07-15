import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { recreateAgentSession } from "@/lib/agent-runner";

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

  const body = (await request.json()) as { branch?: string; prompt?: string };
  const branch = body.branch?.trim() ?? "";
  const prompt = body.prompt?.trim() ?? "";
  if (!branch) {
    return NextResponse.json({ error: "Branch is required" }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  try {
    const result = await recreateAgentSession(id, branch, prompt);
    return NextResponse.json(result, {
      status: result.queued ? 202 : 201,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to recreate agent session";
    const status = message.includes("active") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
