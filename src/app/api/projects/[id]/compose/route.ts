import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  readComposeStudioState,
  saveComposeOnNewBranch,
} from "@/lib/compose-studio";

export async function GET(
  _request: Request,
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
  const state = readComposeStudioState(project.clonePath, project.branch);
  return NextResponse.json(state);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json()) as { yaml?: string; envText?: string };
  if (typeof body.yaml !== "string") {
    return NextResponse.json({ error: "yaml is required" }, { status: 400 });
  }
  try {
    const saved = await saveComposeOnNewBranch({
      projectId: id,
      yaml: body.yaml,
      envText: body.envText,
      createIfMissing: true,
    });
    return NextResponse.json(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save compose";
    const status = /Invalid|must be/i.test(message) ? 400 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
