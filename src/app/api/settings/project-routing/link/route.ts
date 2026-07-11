import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { setProjectRouteLink } from "@/lib/project-routing";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    projectId?: string;
    routeKey?: string;
    linked?: boolean;
  };

  const projectId = body.projectId?.trim() ?? "";
  const routeKey = body.routeKey?.trim() ?? "";
  const linked = body.linked === true;

  if (!projectId || !routeKey) {
    return NextResponse.json(
      { error: "projectId and routeKey are required" },
      { status: 400 },
    );
  }

  try {
    const linkedRouteKeys = setProjectRouteLink(projectId, routeKey, linked);
    return NextResponse.json({ projectId, routeKey, linked, linkedRouteKeys });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update link";
    const status = message.includes("not found") ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
