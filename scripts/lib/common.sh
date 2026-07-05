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
}

compose_cmd() {
  local file
  file="$(compose_file_path)"
  if [[ -z "$file" ]]; then
    echo "No compose file found" >&2
    exit 1
  fi
  export_compose_env
  docker compose -f "$file" "$@"
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
