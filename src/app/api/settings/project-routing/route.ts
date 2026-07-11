import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listHttpServers, parseHttpRoutes } from "@/lib/caddy-config";
import { getCaddyConfig } from "@/lib/caddy";
import { composeProjectName } from "@/lib/compose-project-name";
import {
  buildRouteToProjectsIndex,
  listProjectRoutingRows,
} from "@/lib/project-routing";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET() {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = await getCaddyConfig();
    const projects = listProjectRoutingRows().map((project) => ({
      ...project,
      composeProjectName: composeProjectName(project.name),
    }));
    const routeLinks = Object.fromEntries(buildRouteToProjectsIndex());

    return NextResponse.json({
      projects,
      caddy: {
        servers: listHttpServers(config),
        routes: parseHttpRoutes(config),
      },
      routeLinks,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load project routing";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
