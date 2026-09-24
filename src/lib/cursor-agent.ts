import { existsSync } from "fs";
import { isExecutable } from "@/lib/docker-runtime";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

const AGENT_CANDIDATES = [
  () => "/usr/local/bin/agent",
  () => "/opt/cursor-agent/cursor-agent",
  () => "/opt/cursor-agent/agent",
] as const;

function agentBinUsable(path: string): boolean {
  return isExecutable(path) || existsSync(path);
}

export function resolveCursorAgentBin(): string {
  const fromEnv = process.env.FORGE_AGENT_BIN?.trim();
  if (fromEnv) {
    if (agentBinUsable(fromEnv)) return fromEnv;
    throw new Error(
      `Cursor agent CLI is not available in this container. Redeploy ${APP_DISPLAY_NAME} with ./deploy.sh so the host agent directory is bind-mounted.`,
    );
  }

  for (const candidate of AGENT_CANDIDATES) {
    const path = candidate();
    if (!path) continue;
    if (agentBinUsable(path)) return path;
  }

  throw new Error(
    `Cursor agent CLI is not available in this container. Redeploy ${APP_DISPLAY_NAME} with ./deploy.sh so the host agent directory is bind-mounted.`,
  );
}

export function cursorAgentAvailable(): boolean {
  try {
    resolveCursorAgentBin();
    return true;
  } catch {
    return false;
  }
}
