import { NextResponse } from "next/server";
import type { OpsAuth } from "@/lib/ops-api-auth";
import { resolveOpsActor, resolveOpsActorSessionId } from "@/lib/ops-api-route";
import {
  TicketError,
  type TicketCaller,
  type TicketClaim,
} from "@/lib/tickets";

export function asTicketError(err: unknown): TicketError | null {
  return err instanceof TicketError ? err : null;
}

export function ticketErrorResponse(err: unknown): NextResponse | null {
  const ticketError = asTicketError(err);
  if (!ticketError) return null;
  return NextResponse.json(
    { error: ticketError.message, code: ticketError.code },
    { status: ticketError.status },
  );
}

export function opsTicketClaim(auth: OpsAuth, request: Request): TicketClaim {
  const sessionId = resolveOpsActorSessionId(auth, request);
  return {
    kind: "ops",
    sessionId,
    actor:
      auth.kind === "session"
        ? `session:${auth.sessionId}`
        : resolveOpsActor(auth),
  };
}

export function opsTicketCaller(auth: OpsAuth, request: Request): TicketCaller {
  const sessionId = resolveOpsActorSessionId(auth, request);
  return {
    sessionId,
    actor:
      auth.kind === "session"
        ? `session:${auth.sessionId}`
        : resolveOpsActor(auth),
    operator: auth.kind !== "session",
  };
}

export function parseTicketFields(body: Record<string, unknown>): {
  title?: string;
  description?: string;
  dependsOnTicketIds?: string[];
} {
  const title = typeof body.title === "string" ? body.title : undefined;
  const description =
    typeof body.description === "string" ? body.description : undefined;
  const raw = body.dependsOnTicketIds;
  const dependsOnTicketIds = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string")
    : undefined;
  return { title, description, dependsOnTicketIds };
}
