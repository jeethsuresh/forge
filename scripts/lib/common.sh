#!/usr/bin/env bash
# Shared flags and helpers for build.sh, test.sh, deploy.sh, teardown.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-forge}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
HOST_PORT="${HOST_PORT:-3000}"
REMOVE_VOLUMES="${REMOVE_VOLUMES:-0}"
REMOVE_ORPHANS="${REMOVE_ORPHANS:-1}"
DETACH="${DETACH:-1}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_LINT="${SKIP_LINT:-0}"
PID_FILE="${PID_FILE:-./data/forge.pid}"
PODMAN_API_PID_FILE="${PODMAN_API_PID_FILE:-./data/podman-api.pid}"
FORGE_PODMAN_API_PORT="${FORGE_PODMAN_API_PORT:-18765}"
FORGE_HOST_MOUNTS_FILE="${FORGE_HOST_MOUNTS_FILE:-/data/forge-host-mounts.json}"

persist_host_mount_paths() {
  if [[ -z "${FORGE_CURSOR_AGENT_DIR:-}" ]]; then
    return 0
  fi
  local dir
  dir="$(dirname "$FORGE_HOST_MOUNTS_FILE")"
  if ! mkdir -p "$dir" 2>/dev/null; then
    return 0
  fi
  FORGE_HOST_MOUNTS_FILE="$FORGE_HOST_MOUNTS_FILE" python3 - <<'PY'
import json, os
from datetime import datetime, timezone

path = os.environ["FORGE_HOST_MOUNTS_FILE"]
payload = {
    "cursorAgentDir": os.environ.get("FORGE_CURSOR_AGENT_DIR", "").strip(),
    "cursorConfigDir": os.environ.get("FORGE_CURSOR_CONFIG_DIR", "").strip(),
    "updatedAt": datetime.now(timezone.utc).isoformat(),
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
PY
}

load_persisted_host_mount_paths() {
  if [[ ! -f "$FORGE_HOST_MOUNTS_FILE" ]]; then
    return 1
  fi
  eval "$(
    FORGE_HOST_MOUNTS_FILE="$FORGE_HOST_MOUNTS_FILE" python3 - <<'PY'
import json, os, shlex, sys

path = os.environ["FORGE_HOST_MOUNTS_FILE"]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
agent = (data.get("cursorAgentDir") or "").strip()
config = (data.get("cursorConfigDir") or "").strip()
if agent:
    print(f"export FORGE_CURSOR_AGENT_DIR={shlex.quote(agent)}")
if config:
    print(f"export FORGE_CURSOR_CONFIG_DIR={shlex.quote(config)}")
PY
  )"
  [[ -n "${FORGE_CURSOR_AGENT_DIR:-}" ]]
}

ensure_cursor_mount_env() {
  if [[ -z "${FORGE_CURSOR_AGENT_DIR:-}" || -z "${FORGE_CURSOR_CONFIG_DIR:-}" ]]; then
    load_persisted_host_mount_paths || true
  fi
  if [[ -z "${FORGE_CURSOR_AGENT_DIR:-}" ]]; then
    FORGE_CURSOR_AGENT_DIR="$(resolve_cursor_agent_dir)"
    export FORGE_CURSOR_AGENT_DIR
  fi
  if [[ -z "${FORGE_CURSOR_CONFIG_DIR:-}" ]]; then
    FORGE_CURSOR_CONFIG_DIR="$(resolve_cursor_config_dir)"
    export FORGE_CURSOR_CONFIG_DIR
  fi
  if [[ -z "${FORGE_CURSOR_CONFIG_DIR:-}" ]]; then
    if [[ -n "${FORGE_CURSOR_API_KEY:-${CURSOR_API_KEY:-}}" ]]; then
      local config_dir="${ROOT_DIR}/data/cursor-config-stub"
      mkdir -p "$config_dir"
      FORGE_CURSOR_CONFIG_DIR="$config_dir"
      export FORGE_CURSOR_CONFIG_DIR
    fi
  fi
  persist_host_mount_paths
}

compose_file_path() {
  if [[ -f "$COMPOSE_FILE" ]]; then
    echo "$COMPOSE_FILE"
    return
  fi
  for candidate in docker-compose.yml docker-compose.yaml compose.yml; do
    if [[ -f "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
  echo ""
}

has_compose_file() {
  [[ -n "$(compose_file_path)" ]]
}

export_compose_env() {
  export COMPOSE_PROJECT_NAME
  export HOST_PORT
  export FORGE_PODMAN_API_PORT
  ensure_cursor_mount_env
}

resolve_cursor_config_dir() {
  if [[ -n "${FORGE_CURSOR_CONFIG_DIR:-}" ]]; then
    echo "$FORGE_CURSOR_CONFIG_DIR"
    return
  fi

  if [[ -d "${HOME}/.config/cursor" ]]; then
    echo "${HOME}/.config/cursor"
    return
  fi

  echo ""
}

resolve_cursor_agent_dir() {
  if [[ -n "${FORGE_CURSOR_AGENT_DIR:-}" ]]; then
    echo "$FORGE_CURSOR_AGENT_DIR"
    return
  fi

  local agent_bin="${HOME}/.local/bin/agent"
  if [[ -e "$agent_bin" ]]; then
    local resolved
    resolved="$(readlink -f "$agent_bin" 2>/dev/null || true)"
    if [[ -n "$resolved" && -f "$resolved" ]]; then
      dirname "$resolved"
      return
    fi
  fi

  local latest=""
  latest="$(
    ls -1d "${HOME}/.local/share/cursor-agent/versions/"*/cursor-agent 2>/dev/null \
      | sort -V \
      | tail -1 \
      || true
  )"
  if [[ -n "$latest" ]]; then
    dirname "$latest"
    return
  fi

  echo ""
}

require_cursor_agent() {
  ensure_cursor_mount_env

  if [[ -z "${FORGE_CURSOR_AGENT_DIR:-}" ]]; then
    echo "Cursor agent CLI not found. Install it on the host or set FORGE_CURSOR_AGENT_DIR." >&2
    exit 1
  fi

  if [[ -x "${FORGE_CURSOR_AGENT_DIR}/cursor-agent" ]]; then
    :
  elif [[ -f "$FORGE_HOST_MOUNTS_FILE" ]]; then
    :
  else
    echo "Cursor agent CLI not found at ${FORGE_CURSOR_AGENT_DIR}/cursor-agent. Install it on the host or set FORGE_CURSOR_AGENT_DIR." >&2
    exit 1
  fi

  if [[ -z "${FORGE_CURSOR_CONFIG_DIR:-}" ]]; then
    if [[ -n "${FORGE_CURSOR_API_KEY:-${CURSOR_API_KEY:-}}" ]]; then
      local config_dir="${ROOT_DIR}/data/cursor-config-stub"
      mkdir -p "$config_dir"
      FORGE_CURSOR_CONFIG_DIR="$config_dir"
      export FORGE_CURSOR_CONFIG_DIR
      persist_host_mount_paths
    else
      echo "Cursor credentials required: run 'agent login' on the host or set FORGE_CURSOR_API_KEY in .env." >&2
      exit 1
    fi
  fi
}

start_podman_api_service() {
  if ss -tln 2>/dev/null | grep -q ":${FORGE_PODMAN_API_PORT} "; then
    return 0
  fi

  mkdir -p "$(dirname "$PODMAN_API_PID_FILE")"
  podman system service --time=0 "tcp://127.0.0.1:${FORGE_PODMAN_API_PORT}" \
    >>./data/podman-api.log 2>&1 &
  echo $! > "$PODMAN_API_PID_FILE"

  for _ in $(seq 1 30); do
    if ss -tln 2>/dev/null | grep -q ":${FORGE_PODMAN_API_PORT} "; then
      return 0
    fi
    sleep 0.2
  done

  echo "Podman API service failed to start on port ${FORGE_PODMAN_API_PORT}" >&2
  exit 1
}

stop_podman_api_service() {
  if [[ ! -f "$PODMAN_API_PID_FILE" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "$PODMAN_API_PID_FILE")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$PODMAN_API_PID_FILE"
}

compose_cmd() {
  local file
  file="$(compose_file_path)"
  if [[ -z "$file" ]]; then
    echo "No compose file found" >&2
    exit 1
  fi
  export_compose_env
  docker compose -f "$file" -p "$COMPOSE_PROJECT_NAME" "$@"
}

resolve_docker_socket() {
  if [[ -n "${DOCKER_SOCKET:-}" ]]; then
    if [[ -S "$DOCKER_SOCKET" ]]; then
      echo "$DOCKER_SOCKET"
      return
    fi
    echo "DOCKER_SOCKET is set but not a socket: $DOCKER_SOCKET" >&2
    exit 1
  fi

  local candidates=(
    /var/run/docker.sock
    /run/podman/podman.sock
    "/run/user/$(id -u)/podman/podman.sock"
  )
  for sock in "${candidates[@]}"; do
    if [[ -S "$sock" ]]; then
      echo "$sock"
      return
    fi
  done

  local user_sock="/run/user/$(id -u)/podman/podman.sock"
  if systemctl --user start podman.socket 2>/dev/null && [[ -S "$user_sock" ]]; then
    echo "$user_sock"
    return
  fi

  echo "No container socket found. Start podman.socket (systemctl --user start podman.socket) or set DOCKER_SOCKET." >&2
  exit 1
}

export_docker_socket() {
  DOCKER_SOCKET="$(resolve_docker_socket)"
  export DOCKER_SOCKET
}

common_usage() {
  cat <<EOF
Common options:
  --project-name NAME   Compose project name (default: forge)
  --compose-file FILE   Compose file path (default: docker-compose.yml)
  --host-port PORT      Host port for published services (default: 3000)
  -h, --help            Show help
EOF
}

parse_common_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project-name)
        COMPOSE_PROJECT_NAME="$2"
        shift 2
        ;;
      --compose-file)
        COMPOSE_FILE="$2"
        shift 2
        ;;
      --host-port|--port)
        HOST_PORT="$2"
        shift 2
        ;;
      -h|--help)
        return 1
        ;;
      --)
        shift
        REMAINING_ARGS=("$@")
        return 0
        ;;
      *)
        REMAINING_ARGS=("$@")
        return 0
        ;;
    esac
  done
  REMAINING_ARGS=()
  return 0
}

stop_pid_file() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}
