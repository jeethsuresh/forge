import { randomUUID } from "crypto";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { opsApiActions } from "@/lib/db/schema";

export const MIN_ACTION_DESCRIPTION_LENGTH = 10;
export const MAX_ACTION_DESCRIPTION_LENGTH = 2000;

export function validateActionDescription(value: unknown): string | null {
  if (typeof value !== "string") {
    return "actionDescription is required and must be a string";
  }
  const trimmed = value.trim();
  if (trimmed.length < MIN_ACTION_DESCRIPTION_LENGTH) {
    return `actionDescription must be at least ${MIN_ACTION_DESCRIPTION_LENGTH} characters`;
  }
  if (trimmed.length > MAX_ACTION_DESCRIPTION_LENGTH) {
    return `actionDescription must be at most ${MAX_ACTION_DESCRIPTION_LENGTH} characters`;
  }
  return null;
}

export function parseActionDescription(body: Record<string, unknown>): {
  actionDescription: string;
  error: string | null;
} {
  const error = validateActionDescription(body.actionDescription);
  if (error) {
    return { actionDescription: "", error };
  }
  return {
    actionDescription: (body.actionDescription as string).trim(),
    error: null,
  };
}

export interface RecordOpsActionInput {
  actionDescription: string;
  method: string;
  path: string;
  requestBody?: Record<string, unknown> | null;
  responseStatus: number;
  projectId?: string | null;
  agentSessionId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
}

export function recordOpsAction(input: RecordOpsActionInput): string {
  const id = randomUUID();
  const sanitizedBody = input.requestBody
    ? { ...input.requestBody, actionDescription: input.actionDescription }
    : { actionDescription: input.actionDescription };

  db.insert(opsApiActions)
    .values({
      id,
      actionDescription: input.actionDescription,
      method: input.method,
      path: input.path,
      requestBodyJson: JSON.stringify(sanitizedBody),
      responseStatus: input.responseStatus,
      actor: "agent",
      agentSessionId: input.agentSessionId ?? null,
      projectId: input.projectId ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      createdAt: new Date(),
    })
    .run();

  return id;
}

export function listRecentOpsActions(
  limit = 50,
  filter?: { projectId?: string; agentSessionId?: string },
) {
  const rows = db
    .select()
    .from(opsApiActions)
    .orderBy(desc(opsApiActions.createdAt))
    .limit(Math.max(limit * 5, limit))
    .all();

  const scoped = rows.filter((row) => {
    if (filter?.projectId && row.projectId !== filter.projectId) return false;
    if (filter?.agentSessionId && row.agentSessionId !== filter.agentSessionId) {
      return false;
    }
    return true;
  });

  return scoped.slice(0, limit);
}
