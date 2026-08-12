import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listServiceDirectoryApi } from "@/lib/service-directory-api";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim() || undefined;

  return NextResponse.json({
    services: listServiceDirectoryApi(
      projectId ? { projectId } : undefined,
    ),
  });
}
