import { NextResponse } from "next/server";
import { listServiceDirectoryApi } from "@/lib/service-directory-api";
import { requireOpsAuth } from "@/lib/ops-api-route";

export async function GET(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const projectIdFilter = url.searchParams.get("projectId")?.trim() || undefined;

  if (auth.kind === "session") {
    if (projectIdFilter && projectIdFilter !== auth.projectId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({
      services: listServiceDirectoryApi({ projectId: auth.projectId }),
    });
  }

  return NextResponse.json({
    services: listServiceDirectoryApi(
      projectIdFilter ? { projectId: projectIdFilter } : undefined,
    ),
  });
}
