import { createReadStream } from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { openArtifactDownload } from "@/lib/artifact-api";
import {
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; name: string; buildId: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id, name, buildId } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;

  const project = requireProject(id);
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
