import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { ensureBranchWorkspace } from "@/lib/branch-workspace";
import {
  readBranchEditorFile,
  writeBranchEditorFile,
} from "@/lib/branch-editor";

export async function GET(
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

  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  const branch =
    url.searchParams.get("branch")?.trim() || project.branch;

  try {
    const workspace = await ensureBranchWorkspace(project, branch);
    const file = await readBranchEditorFile(
      workspace.workspacePath,
      project.branch,
      filePath,
    );
    return NextResponse.json({ file });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
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
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: { path?: string; content?: string; branch?: string };
  try {
    body = (await request.json()) as {
      path?: string;
      content?: string;
      branch?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const filePath = body.path?.trim();
  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  const branch = body.branch?.trim() || project.branch;

  try {
    const workspace = await ensureBranchWorkspace(project, branch);
    await writeBranchEditorFile(workspace.workspacePath, filePath, body.content);
    return NextResponse.json({ saved: true, path: filePath, branch });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
