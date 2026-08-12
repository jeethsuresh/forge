import { createReadStream } from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { openArtifactDownload } from "@/lib/artifact-api";

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; name: string; buildId: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, name, buildId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const artifactName = decodeURIComponent(name).trim();
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  const result = await openArtifactDownload({
    projectId: id,
    name: artifactName,
    buildId,
    token,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const stream = Readable.toWeb(
    createReadStream(result.absolutePath),
  ) as ReadableStream;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename.replace(/"/g, "")}"`,
      ...(result.sizeBytes != null
        ? { "Content-Length": String(result.sizeBytes) }
        : {}),
    },
  });
}
