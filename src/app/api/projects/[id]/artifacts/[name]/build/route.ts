import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { buildArtifact, getArtifactBuild } from "@/lib/artifact-build";
import { serializeArtifactBuild } from "@/lib/artifact-api";

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

  const artifactName = decodeURIComponent(name).trim();
  if (!artifactName) {
    return NextResponse.json(
      { error: "Artifact name is required" },
      { status: 400 },
    );
  }

  let body: { branch?: string } = {};
  try {
    body = (await request.json()) as { branch?: string };
  } catch {
    body = {};
  }

  const branch =
    typeof body.branch === "string" && body.branch.trim()
      ? body.branch.trim()
      : undefined;

  try {
    const buildId = await buildArtifact(id, artifactName, { branch });
    const build = getArtifactBuild(buildId);
    return NextResponse.json(
      {
        ok: true,
        buildId,
        build: build ? serializeArtifactBuild(build) : null,
      },
      { status: build?.status === "failed" ? 409 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Artifact build failed";
    const status = /Forgefile|not declared|not found/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
