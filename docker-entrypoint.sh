#!/bin/bash
set -euo pipefail

mkdir -p /data/repos /data/agent-home/.cache /data/agent-home/.config /data/agent-home/.cursor/chats

link_cursor_agent() {
  local candidate
  for candidate in \
    /opt/cursor-agent/cursor-agent \
    /opt/cursor-agent/agent; do
    if [[ -x "$candidate" ]]; then
      ln -sf "$candidate" /usr/local/bin/agent
      return 0
    fi
  done
  return 1
}

if ! link_cursor_agent; then
  echo "WARNING: Cursor agent not found under /opt/cursor-agent. Agent sessions will fail until Forge is redeployed with ./deploy.sh." >&2
fi

if [[ -n "${FORGE_CONTAINER_NAME:-}" ]]; then
  printf '%s\n' "$FORGE_CONTAINER_NAME" > /data/forge-container-name
fi

if [[ -n "${FORGE_CURSOR_AGENT_DIR:-}" ]]; then
  python3 - <<'PY'
import json, os
from datetime import datetime, timezone

path = os.environ.get("FORGE_HOST_MOUNTS_FILE", "/data/forge-host-mounts.json")
agent = os.environ.get("FORGE_CURSOR_AGENT_DIR", "").strip()
config = os.environ.get("FORGE_CURSOR_CONFIG_DIR", "").strip()
if not agent:
    raise SystemExit(0)
os.makedirs(os.path.dirname(path), exist_ok=True)
payload = {
    "cursorAgentDir": agent,
    "cursorConfigDir": config,
    "updatedAt": datetime.now(timezone.utc).isoformat(),
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
PY
fi

rm -rf /data/agent-home/.config/cursor
mkdir -p /data/agent-home/.config/cursor
if [[ -f /opt/cursor-config/auth.json ]]; then
  cp /opt/cursor-config/auth.json /data/agent-home/.config/cursor/auth.json
  chmod 600 /data/agent-home/.config/cursor/auth.json
fi

chown -R node:node /data

if [[ -f /opt/forge/scripts/lib/common.sh ]]; then
  # shellcheck source=scripts/lib/common.sh
  source /opt/forge/scripts/lib/common.sh
  ROOT_DIR=/opt/forge
  init_forge_release_state || true
fi

AGENT_HOME="/data/agent-home"
export HOME="$AGENT_HOME"

GIT_USER_NAME="${FORGE_GIT_USER_NAME:-Forge Agent}"
GIT_USER_EMAIL="${FORGE_GIT_USER_EMAIL:-forge-agent@localhost}"
gosu node env HOME="$AGENT_HOME" git config --global user.name "$GIT_USER_NAME"
gosu node env HOME="$AGENT_HOME" git config --global user.email "$GIT_USER_EMAIL"
gosu node env HOME="$AGENT_HOME" git config --global --add safe.directory '*'

GIT_PASSWORD="${FORGE_GITHUB_TOKEN:-${GITHUB_TOKEN:-${FORGE_GIT_PASSWORD:-}}}"
if [[ -n "$GIT_PASSWORD" ]]; then
  GIT_USERNAME="${FORGE_GIT_USERNAME:-${FORGE_GIT_USER_NAME:-git}}"
  CRED_FILE="${AGENT_HOME}/.git-credentials"
  export GIT_USERNAME GIT_PASSWORD CRED_FILE
  gosu node env HOME="$AGENT_HOME" python3 - <<'PY'
import os
from urllib.parse import quote
user = quote(os.environ["GIT_USERNAME"], safe="")
password = quote(os.environ["GIT_PASSWORD"], safe="")
path = os.environ["CRED_FILE"]
with open(path, "w", encoding="utf-8") as f:
    f.write(f"https://{user}:{password}@github.com\n")
os.chmod(path, 0o600)
PY
  gosu node env HOME="$AGENT_HOME" git config --global credential.helper "store --file ${CRED_FILE}"
fi

exec gosu node env HOME="$AGENT_HOME" "$@"
