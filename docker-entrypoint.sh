#!/bin/bash
set -euo pipefail

mkdir -p /data/repos /data/agent-home/.cache /data/agent-home/.config /data/agent-home/.cursor/chats

if [[ -x /opt/cursor-agent/cursor-agent ]]; then
  ln -sf /opt/cursor-agent/cursor-agent /usr/local/bin/agent
fi

rm -rf /data/agent-home/.config/cursor
mkdir -p /data/agent-home/.config/cursor
if [[ -f /opt/cursor-config/auth.json ]]; then
  cp /opt/cursor-config/auth.json /data/agent-home/.config/cursor/auth.json
  chmod 600 /data/agent-home/.config/cursor/auth.json
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
  python3 - <<'PY'
import os
from urllib.parse import quote
user = quote(os.environ["GIT_USERNAME"], safe="")
password = quote(os.environ["GIT_PASSWORD"], safe="")
path = os.environ["CRED_FILE"]
with open(path, "w", encoding="utf-8") as f:
    f.write(f"https://{user}:{password}@github.com\n")
PY
  chmod 600 "$CRED_FILE"
  gosu node env HOME="$AGENT_HOME" git config --global credential.helper "store --file ${CRED_FILE}"
fi

chown -R node:node /data/repos /data/agent-home
for db_file in /data/forge.db /data/forge.db-shm /data/forge.db-wal; do
  if [[ -e "$db_file" ]]; then
    chown node:node "$db_file"
  fi
done

exec gosu node env HOME="$AGENT_HOME" "$@"
