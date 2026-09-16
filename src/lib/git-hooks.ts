import { chmodSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { opsApiBaseUrl, resolveOpsSessionSecret } from "@/lib/ops-api-auth";

/** Secret header for post-receive → Forge notify. Never a hardcoded prod default. */
export function resolveGitHookSecret(): string {
  const fromEnv = process.env.FORGE_GIT_HOOK_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.FORGE_DB_PATH === ":memory:") {
    return process.env.FORGE_OPS_SESSION_SECRET?.trim() || "test-git-hook-secret";
  }
  const fromOpsEnv = process.env.FORGE_OPS_SESSION_SECRET?.trim();
  if (fromOpsEnv) return fromOpsEnv;
  return resolveOpsSessionSecret();
}

export function gitHookNotifyUrl(): string {
  return `${opsApiBaseUrl()}/api/git/hooks/post-receive`;
}

/**
 * Install a bare-repo post-receive hook that POSTs slug + updated refs to Forge.
 */
export function installPostReceiveHook(
  barePath: string,
  slug: string,
): string {
  const hooksDir = join(barePath, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "post-receive");
  const notifyUrl = gitHookNotifyUrl();
  const secret = resolveGitHookSecret();

  const script = `#!/bin/sh
# Forge post-receive → Forgefile pickup + auto_deploy wake
set -eu
SLUG=${JSON.stringify(slug)}
NOTIFY_URL=${JSON.stringify(notifyUrl)}
SECRET=${JSON.stringify(secret)}
PAYLOAD=$(
  printf '{"slug":"%s","refs":[' "$SLUG"
  first=1
  while read oldrev newrev refname; do
    if [ "$first" -eq 0 ]; then printf ','; fi
    first=0
    branch=\${refname#refs/heads/}
    printf '{"old":"%s","new":"%s","ref":"%s","branch":"%s"}' \\
      "$oldrev" "$newrev" "$refname" "$branch"
  done
  printf ']}'
)
notify() {
  if command -v curl >/dev/null 2>&1; then
    curl -sS -X POST "$NOTIFY_URL" \\
      -H "Content-Type: application/json" \\
      -H "X-Forge-Git-Hook-Secret: $SECRET" \\
      -d "$PAYLOAD"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O - --header="Content-Type: application/json" \\
      --header="X-Forge-Git-Hook-Secret: $SECRET" \\
      --post-data="$PAYLOAD" "$NOTIFY_URL"
  else
    echo "forge post-receive: curl or wget required" >&2
    return 1
  fi
}
if ! notify >/dev/null; then
  echo "forge post-receive: notify failed, retrying once" >&2
  sleep 1
  if ! notify >/dev/null; then
    echo "forge post-receive: notify failed after retry" >&2
  fi
fi
`;

  writeFileSync(hookPath, script, { mode: 0o755 });
  chmodSync(hookPath, 0o755);
  return hookPath;
}
