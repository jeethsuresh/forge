import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isAgentBackendId } from "@/lib/agent-backends/types";
import { listAvailableBackendInfo } from "@/lib/agent-backends/registry";
import {
  listBackendSettings,
  upsertBackendSettings,
} from "@/lib/agent-backends/settings";

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

  return NextResponse.json({
    backends: listAvailableBackendInfo(),
    settings: listBackendSettings(),
  });
}

export async function POST(request: Request) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    backend?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string | null;
  };
  const backendId = body.backend ?? "";
  if (!isAgentBackendId(backendId)) {
    return NextResponse.json(
      { error: "backend must be cursor, codex, or local" },
      { status: 400 },
    );
  }

  try {
    const settings = upsertBackendSettings({
      backend: backendId,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });
    return NextResponse.json({
      settings,
      backends: listAvailableBackendInfo(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
