import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { runNamedProjectScript } from "@/lib/forgefile-run";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, name } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const scriptName = decodeURIComponent(name).trim();
  if (!scriptName) {
    return NextResponse.json({ error: "Script name is required" }, { status: 400 });
  }

  try {
    const lines: string[] = [];
    await runNamedProjectScript(id, scriptName, (line) => lines.push(line));
    return NextResponse.json({ ok: true, output: lines.join("\n") });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Script run failed";
    const status = /Forgefile|not defined|not found/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
