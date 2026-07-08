#!/usr/bin/env bash
# Replaces the production Forge container from a detached sidecar so the running
# app is not asked to recreate itself.
set -euo pipefail

IMAGE_TAG="${FORGE_IMAGE_TAG:-next}"
IMAGE_NAME="${FORGE_IMAGE_NAME:-forge-app}"
SOURCE_DIR="${FORGE_SOURCE_DIR:-/data/forge-source}"
STATE_FILE="${FORGE_RELEASE_STATE:-/data/forge-release.json}"
HOST_PORT="${HOST_PORT:-3000}"
COMPOSE_SLUG="${COMPOSE_PROJECT_NAME:-forge}"
COMMIT_SHA="${FORGE_RELEASE_COMMIT_SHA:-}"
HEALTH_PATH="${FORGE_HEALTH_PATH:-/api/forge/health}"
HEALTH_RETRIES="${FORGE_HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${FORGE_HEALTH_INTERVAL:-2}"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

load_common_sh() {
  if [[ -f "${SOURCE_DIR}/scripts/lib/common.sh" ]]; then
    # shellcheck source=scripts/lib/common.sh
    source "${SOURCE_DIR}/scripts/lib/common.sh"
    return 0
  fi
  if [[ -f "/opt/forge/scripts/lib/common.sh" ]]; then
    # shellcheck source=scripts/lib/common.sh
    source "/opt/forge/scripts/lib/common.sh"
    return 0
  fi
  return 1
}

wait_for_health() {
  local port="$1"
  local label="$2"
  local url="http://127.0.0.1:${port}${HEALTH_PATH}"
  local attempt detail
  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      log "${label} health check passed (attempt ${attempt})"
      return 0
    fi
    detail="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || echo failed)"
    if [[ "$attempt" -eq 1 || $((attempt % 5)) -eq 0 ]]; then
      log "${label} health check attempt ${attempt}/${HEALTH_RETRIES}: HTTP ${detail} (${url})"
    fi
    sleep "$HEALTH_INTERVAL"
  done
  log "${label} health check failed after ${HEALTH_RETRIES} attempts (${url})"
  return 1
}

save_release_state() {
  local commit_sha="$1"
  mkdir -p "$(dirname "$STATE_FILE")"
  cat >"$STATE_FILE" <<EOF
{
  "stableImageTag": "stable",
  "rollbackImageTag": "rollback",
  "stableCommitSha": "${commit_sha}",
  "updatedAt": "$(date -Iseconds)"
}
EOF
}

if ! load_common_sh; then
  log "ERROR: could not load scripts/lib/common.sh"
  exit 1
fi

export FORGE_IMAGE_TAG="$IMAGE_TAG"
export HOST_PORT
export COMPOSE_PROJECT_NAME="$COMPOSE_SLUG"
export_compose_env

log "Production cutover starting (project=${COMPOSE_SLUG}, image=${IMAGE_TAG}, port=${HOST_PORT})"
if [[ -n "${FORGE_CONTAINER_NAME:-}" ]]; then
  docker rm -f "${FORGE_CONTAINER_NAME}" >/dev/null 2>&1 || true
fi
compose_cmd up -d
remove_orphan_compose_container

if ! wait_for_health "$HOST_PORT" "Production"; then
  log "ERROR: production health check failed after cutover"
  exit 1
fi

if docker image inspect "${IMAGE_NAME}:stable" >/dev/null 2>&1; then
  docker tag "${IMAGE_NAME}:stable" "${IMAGE_NAME}:rollback"
fi
docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:stable"

if [[ -n "$COMMIT_SHA" ]]; then
  save_release_state "$COMMIT_SHA"
fi

log "Production cutover completed successfully"
