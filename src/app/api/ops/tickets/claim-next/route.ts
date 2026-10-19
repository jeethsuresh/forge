import { NextResponse } from "next/server";
import { isUnrestrictedOpsAuth } from "@/lib/ops-api-auth";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  denyIfWrongProject,
  requireOpsAuth,
} from "@/lib/ops-api-route";
import { asTicketError, opsTicketClaim } from "@/lib/ticket-http";
import { scheduleTicketDrain } from "@/lib/ticket-scheduler";
import { claimNextTicket } from "@/lib/tickets";

export async function POST(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const path = "/api/ops/tickets/claim-next";
  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;
  const requestedProjectId =
    typeof body.projectId === "string" ? body.projectId : undefined;

  if (requestedProjectId) {
    const forbidden = denyIfWrongProject(auth, requestedProjectId);
    if (forbidden) return forbidden;
  }

  const projectId =
    requestedProjectId ??
    (auth.kind === "session" ? auth.projectId : undefined);

  if (!isUnrestrictedOpsAuth(auth) && !projectId) {
    return errorWithAudit("projectId is required", 400, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      resourceType: "ticket",
    });
  }

  try {
    const ticket = claimNextTicket(opsTicketClaim(auth, request), projectId);
    if (ticket) scheduleTicketDrain();
    return jsonWithAudit(
      { ticket },
      { status: 200 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: ticket?.projectId ?? projectId ?? null,
        resourceType: "ticket",
        resourceId: ticket?.id ?? null,
      },
    );
  } catch (err) {
    const mapped = asTicketError(err);
    if (mapped) {
      return errorWithAudit(mapped.message, mapped.status, {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        resourceType: "ticket",
      });
    }
    throw err;
  }
}
