#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh

usage() {
  cat <<EOF
Usage: ./deploy.sh [options]

Deploy via Docker Compose (docker compose up).

$(common_usage)

Options:
  --detach              Run containers in the background (default)
  --no-detach           Run in the foreground
EOF
}

REMAINING_ARGS=()
if ! parse_common_args "$@"; then
  usage
  exit 0
fi

while [[ ${#REMAINING_ARGS[@]} -gt 0 ]]; do
  case "${REMAINING_ARGS[0]}" in
    --detach)
      DETACH=1
      REMAINING_ARGS=("${REMAINING_ARGS[@]:1}")
      ;;
    --no-detach)
      DETACH=0
      REMAINING_ARGS=("${REMAINING_ARGS[@]:1}")
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: ${REMAINING_ARGS[0]}" >&2
      usage
      exit 1
      ;;
  esac
done

start_podman_api_service

export_docker_socket
require_cursor_agent

prepare_named_container_deploy() {
  if [[ -n "${FORGE_CONTAINER_NAME:-}" ]]; then
    docker rm -f "${FORGE_CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
}

remove_orphan_compose_container() {
  local canonical="${FORGE_CONTAINER_NAME:-}"
  [[ -z "$canonical" ]] && return 0
  if [[ "$canonical" =~ ^(.+)_app_([0-9]+)$ ]]; then
    docker rm -f "${BASH_REMATCH[1]}-app-${BASH_REMATCH[2]}" >/dev/null 2>&1 || true
  fi
}

prepare_named_container_deploy

if [[ "$DETACH" -eq 1 ]]; then
  compose_cmd up -d --force-recreate
else
  compose_cmd up
fi

remove_orphan_compose_container
