import { NextResponse } from "next/server";
import type { OpsAuth } from "@/lib/ops-api-auth";
import { getProjectForgefile } from "@/lib/forgefile-project";

/**
 * When Forgefile is missing/invalid, session tokens may only touch bootstrap paths:
 * forgefile status, heartbeat, events, and limited agent-session controls.
 */
export function isBootstrapOpsPathAllowed(
  method: string,
  pathname: string,
): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  const m = method.toUpperCase();

  if (path === "/api/ops" && m === "GET") return true;

  // Forgefile read (and future write) for the project under bootstrap.
  if (/\/api\/ops\/projects\/[^/]+\/forgefile$/.test(path)) {
    return m === "GET" || m === "PUT" || m === "POST" || m === "PATCH";
  }

  // Heartbeat + event ingest
  if (/\/api\/ops\/projects\/[^/]+\/agent-sessions\/[^/]+\/heartbeat$/.test(path)) {
    return m === "POST";
  }
  if (/\/api\/ops\/projects\/[^/]+\/agent-sessions\/[^/]+\/events$/.test(path)) {
    return m === "POST";
  }

  // Own session read + message/stop/end for the bootstrap agent loop
  if (/\/api\/ops\/projects\/[^/]+\/agent-sessions\/[^/]+$/.test(path)) {
    return m === "GET";
  }
  if (/\/api\/ops\/projects\/[^/]+\/agent-sessions\/[^/]+\/(messages|stop|end)$/.test(path)) {
    return m === "POST";
  }

  // Project detail read (status only)
  if (/\/api\/ops\/projects\/[^/]+$/.test(path) && m === "GET") {
    return true;
  }

  return false;
}

export function projectNeedsForgefileBootstrap(projectId: string): boolean {
  const row = getProjectForgefile(projectId);
  if (!row) return true;
  return row.status !== "valid";
}

/**
 * Deny session-token Ops calls outside the bootstrap allowlist when Forgefile
 * is missing/invalid. Global tokens are unrestricted.
 */
export function denyIfBootstrapRestricted(
  auth: OpsAuth,
  request: Request,
): NextResponse | null {
  if (auth.kind !== "session") return null;
  if (!projectNeedsForgefileBootstrap(auth.projectId)) return null;

  const url = new URL(request.url);
  if (isBootstrapOpsPathAllowed(request.method, url.pathname)) {
    return null;
  }

  return NextResponse.json(
    {
      error:
        "Forgefile bootstrap mode: Ops access is limited to forgefile, heartbeat, events, and agent session controls until a valid Forgefile exists.",
      bootstrapMode: true,
    },
    { status: 403 },
  );
}
