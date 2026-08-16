import { isSelfUpdateTestStage, shouldRunLiveSmoke } from "@/lib/live-smoke";

export function parseDotEnvValue(
  text: string,
  key: string,
): string | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.startsWith(`${key}=`)) {
      continue;
    }
    let value = trimmed.slice(key.length + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return undefined;
}

export function forgeAdminCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { username: string; password: string } {
  return {
    username: env.FORGE_ADMIN_USERNAME?.trim() || "admin",
    password: env.FORGE_ADMIN_PASSWORD?.trim() || "admin",
  };
}

/** Browser/studio e2e against a live Forge instance. Never nested in updater staging. */
export function shouldRunUiE2e(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.FORGE_UI_E2E === "0") return false;
  if (isSelfUpdateTestStage(env)) return false;
  if (env.FORGE_UI_E2E === "1") return true;
  return shouldRunLiveSmoke(env);
}

export function uiE2eBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env.FORGE_OPS_API_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
}
