import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  listHttpServers,
  parseHttpRoutes,
} from "@/lib/caddy-config";
import {
  CaddyApiError,
  getCaddyConfig,
  loadCaddyConfig,
} from "@/lib/caddy";

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
    return NextResponse.json({
      adminUrl: process.env.FORGE_CADDY_ADMIN_URL ?? process.env.CADDY_ADMIN ?? "http://127.0.0.1:2019",
      config,
      servers: listHttpServers(config),
      routes: parseHttpRoutes(config),
    });
  } catch (err) {
    if (err instanceof CaddyApiError) {
      return NextResponse.json(
        { error: err.message, details: err.body },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to reach Caddy admin API";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    config?: unknown;
  } | null;

  if (!body?.config || typeof body.config !== "object") {
    return NextResponse.json(
      { error: "Request body must include a config object" },
      { status: 400 },
    );
  }

  try {
    await loadCaddyConfig(body.config);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CaddyApiError) {
      return NextResponse.json(
        { error: err.message, details: err.body },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to load Caddy config";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
