import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentBackendSettings,
  type AgentBackendId as DbBackendId,
} from "@/lib/db/schema";
import { readGlobalSecret, storeSecret, deleteGlobalSecret } from "@/lib/agent-secrets";
import type {
  AgentBackendId,
  AgentBackendSettings,
} from "@/lib/agent-backends/types";
import { AGENT_BACKEND_IDS } from "@/lib/agent-backends/types";

export const CODEX_SECRET_NAME = "CODEX_API_KEY";
export const LOCAL_SECRET_NAME = "LOCAL_AGENT_API_KEY";

export function secretNameForBackend(backend: AgentBackendId): string | null {
  if (backend === "codex") return CODEX_SECRET_NAME;
  if (backend === "local") return LOCAL_SECRET_NAME;
  return null;
}

function envFallbackModel(backend: AgentBackendId): string {
  if (backend === "cursor") {
    return process.env.FORGE_CURSOR_MODEL?.trim() ?? "";
  }
  if (backend === "codex") {
    return process.env.FORGE_CODEX_MODEL?.trim() ?? "";
  }
  return process.env.FORGE_LOCAL_AGENT_MODEL?.trim() ?? "";
}

function envFallbackBaseUrl(backend: AgentBackendId): string {
  if (backend === "local") {
    return process.env.FORGE_LOCAL_AGENT_BASE_URL?.trim() ?? "";
  }
  return "";
}

export function getBackendSettings(backend: AgentBackendId): AgentBackendSettings {
  const row = db
    .select()
    .from(agentBackendSettings)
    .where(eq(agentBackendSettings.backend, backend as DbBackendId))
    .get();
  const secretName = secretNameForBackend(backend);
  return {
    backend,
    model: row?.model?.trim() || envFallbackModel(backend),
    baseUrl: row?.baseUrl?.trim() || envFallbackBaseUrl(backend),
    hasApiKey: secretName
      ? Boolean(readGlobalSecret(secretName) || backendApiKey(backend))
      : Boolean(backendApiKey(backend)),
    updatedAt: row?.updatedAt ?? null,
  };
}

export function listBackendSettings(): AgentBackendSettings[] {
  return AGENT_BACKEND_IDS.map((id) => getBackendSettings(id));
}

export function upsertBackendSettings(input: {
  backend: AgentBackendId;
  model?: string;
  baseUrl?: string;
  apiKey?: string | null;
}): AgentBackendSettings {
  const current = getBackendSettings(input.backend);
  const model = input.model !== undefined ? input.model.trim() : current.model;
  const baseUrl =
    input.baseUrl !== undefined ? input.baseUrl.trim() : current.baseUrl;
  const now = new Date();
  const existing = db
    .select()
    .from(agentBackendSettings)
    .where(eq(agentBackendSettings.backend, input.backend as DbBackendId))
    .get();
  if (existing) {
    db.update(agentBackendSettings)
      .set({ model, baseUrl, updatedAt: now })
      .where(eq(agentBackendSettings.backend, input.backend as DbBackendId))
      .run();
  } else {
    db.insert(agentBackendSettings)
      .values({
        backend: input.backend as DbBackendId,
        model,
        baseUrl,
        updatedAt: now,
      })
      .run();
  }

  const secretName = secretNameForBackend(input.backend);
  if (secretName && input.apiKey !== undefined) {
    if (input.apiKey === null || input.apiKey.trim() === "") {
      deleteGlobalSecret(secretName);
    } else {
      storeSecret({
        scope: "global",
        name: secretName,
        value: input.apiKey.trim(),
      });
    }
  }

  return getBackendSettings(input.backend);
}

export function backendApiKey(backend: AgentBackendId): string | null {
  if (backend === "cursor") {
    return (
      process.env.FORGE_CURSOR_API_KEY?.trim() ||
      process.env.CURSOR_API_KEY?.trim() ||
      null
    );
  }
  if (backend === "codex") {
    return (
      readGlobalSecret(CODEX_SECRET_NAME) ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.CODEX_API_KEY?.trim() ||
      null
    );
  }
  return (
    readGlobalSecret(LOCAL_SECRET_NAME) ||
    process.env.FORGE_LOCAL_AGENT_API_KEY?.trim() ||
    null
  );
}
