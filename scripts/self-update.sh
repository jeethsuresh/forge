#!/usr/bin/env bash
# Orchestrates Forge self-update with staging health checks and automatic rollback.
# Runs in a detached container so it survives production container recreation.
set -euo pipefail

UPDATE_ID=""
ROLLBACK=0
SOURCE_DIR="${FORGE_SOURCE_DIR:-/data/forge-source}"
STAGING_PORT="${FORGE_STAGING_PORT:-3466}"
STATE_FILE="${FORGE_RELEASE_STATE:-/data/forge-release.json}"
DB_PATH="${FORGE_DB_PATH:-/data/forge.db}"
IMAGE_NAME="${FORGE_IMAGE_NAME:-forge-app}"
STAGING_PROJECT="${FORGE_STAGING_PROJECT_NAME:-forge-staging}"
PROD_PROJECT="${COMPOSE_PROJECT_NAME:-forge}"
HOST_PORT="${HOST_PORT:-3000}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
FORGE_COMPOSE_FILE="${FORGE_COMPOSE_FILE:-/opt/forge/docker-compose.yml}"
FORGE_PODMAN_API_PORT="${FORGE_PODMAN_API_PORT:-18765}"
HEALTH_PATH="/api/forge/health"
HEALTH_RETRIES="${FORGE_HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${FORGE_HEALTH_INTERVAL:-2}"
SELF_UPDATE_DB_PY="${FORGE_SELF_UPDATE_DB_PY:-/opt/forge/scripts/lib/self-update-db.py}"

usage() {
  cat <<EOF
Usage: forge-self-update.sh --update-id ID [options]

Update Forge from its GitHub source with staging validation and rollback.

Options:
  --update-id ID        Forge update record ID (required)
  --rollback            Redeploy the previous stable image instead of pulling new code
  --source-dir PATH     Forge source checkout (default: /data/forge-source)
  --staging-port PORT   Staging port for health checks (default: 3466)
  -h, --help            Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --update-id)
      UPDATE_ID="$2"
      shift 2
      ;;
    --rollback)
      ROLLBACK=1
      shift
      ;;
    --source-dir)
      SOURCE_DIR="$2"
      shift 2
      ;;
    --staging-port)
      STAGING_PORT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$UPDATE_ID" ]]; then
  echo "--update-id is required" >&2
  usage
  exit 1
fi

mark_failed_exit() {
  local code="$1"
  if [[ -n "$UPDATE_ID" && -f "$DB_PATH" ]]; then
    local existing=""
    if resolve_self_update_db_py; then
      existing="$(
        python3 "$SELF_UPDATE_DB_PY" --db "$DB_PATH" --update-id "$UPDATE_ID" get-error \
          2>/dev/null \
          || true
      )"
    fi
    if [[ -z "$existing" ]]; then
      set_status "failed" "Updater exited with code ${code}"
    fi
  fi
}

load_common_sh() {
  if [[ -f "/opt/forge/scripts/lib/common.sh" ]]; then
    # shellcheck source=scripts/lib/common.sh
    source "/opt/forge/scripts/lib/common.sh"
    return 0
  fi
  if [[ -f "${SOURCE_DIR}/scripts/lib/common.sh" ]]; then
    # shellcheck source=scripts/lib/common.sh
    source "${SOURCE_DIR}/scripts/lib/common.sh"
    return 0
  fi
  return 1
}

resolve_self_update_db_py() {
  if [[ -f "$SELF_UPDATE_DB_PY" ]]; then
    return 0
  fi
  if [[ -f "${SOURCE_DIR}/scripts/lib/self-update-db.py" ]]; then
    SELF_UPDATE_DB_PY="${SOURCE_DIR}/scripts/lib/self-update-db.py"
    return 0
  fi
  if [[ -f "/opt/forge/scripts/lib/self-update-db.py" ]]; then
    SELF_UPDATE_DB_PY="/opt/forge/scripts/lib/self-update-db.py"
    return 0
  fi
  return 1
}

forge_db_log() {
  local message="$1"
  if [[ ! -f "$DB_PATH" ]]; then
    return 0
  fi
  resolve_self_update_db_py || return 0
  python3 "$SELF_UPDATE_DB_PY" --db "$DB_PATH" --update-id "$UPDATE_ID" log "$message" \
    2>/dev/null || true
}

forge_db_status() {
  local status="$1"
  local error="${2:-}"
  local completed="${3:-0}"
  local target_commit="${4:-}"
  if [[ ! -f "$DB_PATH" ]]; then
    return 0
  fi
  resolve_self_update_db_py || return 0
  local args=(--db "$DB_PATH" --update-id "$UPDATE_ID" status "$status")
  if [[ -n "$error" ]]; then
    args+=(--error "$error")
  fi
  if [[ "$completed" == "1" ]]; then
    args+=(--completed)
  fi
  if [[ -n "$target_commit" ]]; then
    args+=(--target-commit "$target_commit")
  fi
  if [[ "$status" == "success" ]]; then
    args+=(--clear-error)
  fi
  python3 "$SELF_UPDATE_DB_PY" "${args[@]}" 2>/dev/null || true
}

forge_db_set_previous_commit() {
  local previous_commit="$1"
  if [[ -z "$previous_commit" || ! -f "$DB_PATH" ]]; then
    return 0
  fi
  resolve_self_update_db_py || return 0
  python3 "$SELF_UPDATE_DB_PY" --db "$DB_PATH" --update-id "$UPDATE_ID" \
    previous-commit "$previous_commit" 2>/dev/null || true
}

resolve_built_image_id() {
  local project="$1"
  local image_id=""
  if declare -F resolve_compose_app_image_id >/dev/null; then
    image_id="$(
      cd "$SOURCE_DIR" && COMPOSE_PROJECT_NAME="$project" resolve_compose_app_image_id || true
    )"
  fi
  if [[ -n "$image_id" ]]; then
    echo "$image_id"
    return 0
  fi
  local sha="${FORGE_COMMIT_SHA:-}"
  local candidates=()
  if [[ -n "$sha" ]]; then
    candidates+=("${IMAGE_NAME}:${sha}" "localhost/${IMAGE_NAME}:${sha}")
  fi
  candidates+=("${IMAGE_NAME}:stable" "localhost/${IMAGE_NAME}:stable")
  for ref in "${candidates[@]}"; do
    if docker image inspect "$ref" >/dev/null 2>&1; then
      docker image inspect --format '{{.Id}}' "$ref"
      return 0
    fi
  done
  return 1
}

start_podman_api_inline() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if command -v ss >/dev/null 2>&1 \
    && ss -tln 2>/dev/null | grep -q ":${FORGE_PODMAN_API_PORT} "; then
    return 0
  fi

  if ! command -v podman >/dev/null 2>&1; then
    echo "Container runtime is not reachable and podman is not installed to start an API service." >&2
    exit 1
  fi

  podman system service --time=0 "tcp://127.0.0.1:${FORGE_PODMAN_API_PORT}" \
    >>/data/podman-api.log 2>&1 &
  for _ in $(seq 1 30); do
    if ss -tln 2>/dev/null | grep -q ":${FORGE_PODMAN_API_PORT} "; then
      return 0
    fi
    sleep 0.2
  done
  echo "Podman API service failed to start on port ${FORGE_PODMAN_API_PORT}" >&2
  exit 1
}

compose_inline() {
  if ! declare -F export_compose_env >/dev/null; then
    if [[ -f "${SOURCE_DIR}/scripts/lib/common.sh" ]]; then
      # shellcheck source=scripts/lib/common.sh
      source "${SOURCE_DIR}/scripts/lib/common.sh"
    elif [[ -f "/opt/forge/scripts/lib/common.sh" ]]; then
      # shellcheck source=scripts/lib/common.sh
      source "/opt/forge/scripts/lib/common.sh"
    fi
  fi
  if declare -F export_compose_env >/dev/null; then
    export_compose_env
  else
    load_persisted_host_mount_paths || true
    export COMPOSE_PROJECT_NAME HOST_PORT FORGE_PODMAN_API_PORT
    export FORGE_CURSOR_AGENT_DIR FORGE_CURSOR_CONFIG_DIR
  fi
  local compose_file="$COMPOSE_FILE"
  if [[ ! -f "$compose_file" && -f "$FORGE_COMPOSE_FILE" ]]; then
    compose_file="$FORGE_COMPOSE_FILE"
  fi
  if [[ -z "${FORGE_CURSOR_AGENT_DIR:-}" ]]; then
    echo "Cursor agent host mount path is missing. Redeploy Forge from the host with ./deploy.sh." >&2
    exit 1
  fi
  docker compose -f "$compose_file" -p "$COMPOSE_PROJECT_NAME" "$@"
}

log() {
  local message="[$(date -Iseconds)] $*"
  echo "$message"
  forge_db_log "$message"
}

set_status() {
  local status="$1"
  local error="${2:-}"
  if [[ -n "$error" ]]; then
    forge_db_status "$status" "$error" 1
  else
    forge_db_status "$status"
  fi
}

trap '[[ $? -eq 0 ]] || mark_failed_exit $?' EXIT

mark_success() {
  local commit_sha="${1:-}"
  forge_db_status "success" "" 1 "$commit_sha"
}

mark_rolled_back() {
  local message="${1:-Rolled back to previous release}"
  forge_db_status "rolled_back" "$message" 1
}

wait_for_health() {
  local port="$1"
  local label="$2"
  local attempt
  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -fsS "http://127.0.0.1:${port}${HEALTH_PATH}" >/dev/null 2>&1; then
      log "${label} health check passed (attempt ${attempt})"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  log "${label} health check failed after ${HEALTH_RETRIES} attempts"
  return 1
}

save_release_state() {
  local commit_sha="$1"
  mkdir -p "$(dirname "$STATE_FILE")"
  cat >"$STATE_FILE" <<EOF
{
  "stableImageTag": "${commit_sha}",
  "rollbackImageTag": "rollback",
  "stableCommitSha": "${commit_sha}",
  "updatedAt": "$(date -Iseconds)"
}
EOF
}

read_release_commit() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo ""
    return
  fi
  python3 - <<'PY' "$STATE_FILE"
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(data.get("stableCommitSha") or "")
PY
}

ensure_rollback_image() {
  if docker image inspect "${IMAGE_NAME}:rollback" >/dev/null 2>&1; then
    return 0
  fi
  if docker image inspect "${IMAGE_NAME}:stable" >/dev/null 2>&1; then
    docker tag "${IMAGE_NAME}:stable" "${IMAGE_NAME}:rollback"
    log "Tagged current stable image as rollback"
    return 0
  fi
  local running_id
  running_id="$(docker ps --filter "label=com.docker.compose.service=app" --filter "label=com.docker.compose.project=${PROD_PROJECT}" -q | head -1 || true)"
  if [[ -n "$running_id" ]]; then
    local image_id
    image_id="$(docker inspect --format '{{.Image}}' "$running_id")"
    docker tag "$image_id" "${IMAGE_NAME}:rollback"
    log "Tagged running container image as rollback"
    return 0
  fi
  return 1
}

deploy_production() {
  local image_tag="$1"
  if load_common_sh; then
    export FORGE_IMAGE_TAG="$image_tag"
    export HOST_PORT
    export_compose_env
    compose_cmd up -d --force-recreate
    return
  fi
  COMPOSE_PROJECT_NAME="$PROD_PROJECT" FORGE_IMAGE_TAG="$image_tag" \
    compose_inline up -d --force-recreate
}

teardown_staging() {
  if load_common_sh; then
    COMPOSE_PROJECT_NAME="$STAGING_PROJECT" compose_cmd down --remove-orphans 2>/dev/null || true
    return
  fi
  COMPOSE_PROJECT_NAME="$STAGING_PROJECT" compose_inline down --remove-orphans 2>/dev/null || true
}

FORGE_API_BASE="${FORGE_INTERNAL_URL:-http://127.0.0.1:${HOST_PORT}}"
LAST_UPGRADE_ERROR=""

attempt_forge_recovery() {
  local error_msg="$1"
  # Ensure forge-source is writable by the keep-id app before spawning recovery.
  normalize_source_permissions
  log "Requesting Cursor agent recovery for: ${error_msg}"
  local payload
  payload="$(
    UPDATE_ID="$UPDATE_ID" ERROR_MSG="$error_msg" python3 - <<'PY'
import json, os
print(json.dumps({
    "updateId": os.environ["UPDATE_ID"],
    "errorMessage": os.environ["ERROR_MSG"],
}))
PY
  )"
  local response=""
  if ! response="$(curl -fsS -X POST "${FORGE_API_BASE}/api/forge/recover" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --max-time 1800 2>&1)"; then
    log "Recovery request failed: ${response}"
    return 1
  fi
  local recovered
  recovered="$(printf '%s' "$response" | python3 -c 'import json,sys; print("yes" if json.load(sys.stdin).get("recovered") else "no")')"
  if [[ "$recovered" == "yes" ]]; then
    log "Recovery agent fixed the issue; retrying upgrade"
    return 0
  fi
  log "Recovery agent could not fix the issue"
  return 1
}

build_test_stage_and_cutover() {
  local target_commit="$1"
  local release_tag
  release_tag="$(printf '%s' "$target_commit" | tr '[:upper:]' '[:lower:]')"

  set_status "building"
  log "Building new image (no-cache; tag=${release_tag})"
  if ! (
    cd "$SOURCE_DIR"
    FORGE_COMMIT_SHA="$release_tag" HOST_PORT="$STAGING_PORT" COMPOSE_PROJECT_NAME="$STAGING_PROJECT" \
      ./build.sh --host-port "$STAGING_PORT"
  ); then
    LAST_UPGRADE_ERROR="Build failed"
    return 1
  fi

  local built_id
  built_id="$(
    FORGE_COMMIT_SHA="$release_tag" resolve_built_image_id "$STAGING_PROJECT" || true
  )"
  if [[ -z "$built_id" ]]; then
    LAST_UPGRADE_ERROR="Build did not produce an app image"
    return 1
  fi
  docker tag "$built_id" "${IMAGE_NAME}:${release_tag}"
  log "Tagged build as ${IMAGE_NAME}:${release_tag}"

  set_status "testing"
  log "Running tests"
  if ! (
    cd "$SOURCE_DIR"
    FORGE_DB_PATH=":memory:" COMPOSE_PROJECT_NAME="$STAGING_PROJECT" ./test.sh --host-port "$STAGING_PORT"
  ); then
    LAST_UPGRADE_ERROR="Tests failed"
    return 1
  fi

  set_status "staging"
  log "Starting staging container on port ${STAGING_PORT}"
  if ! (
    cd "$SOURCE_DIR"
    FORGE_IMAGE_TAG="$release_tag" FORGE_COMMIT_SHA="$release_tag" \
      HOST_PORT="$STAGING_PORT" COMPOSE_PROJECT_NAME="$STAGING_PROJECT" \
      ./deploy.sh --host-port "$STAGING_PORT" --project-name "$STAGING_PROJECT" --detach
  ); then
    teardown_staging
    LAST_UPGRADE_ERROR="Staging deploy failed"
    return 1
  fi

  if ! wait_for_health "$STAGING_PORT" "Staging"; then
    teardown_staging
    LAST_UPGRADE_ERROR="Staging health check failed; production was not changed"
    return 1
  fi

  teardown_staging

  set_status "cutover"
  log "Deploying new release to production port ${HOST_PORT}"
  if ! (
    cd "$SOURCE_DIR"
    FORGE_IMAGE_TAG="$release_tag" FORGE_COMMIT_SHA="$release_tag" \
      HOST_PORT="$HOST_PORT" COMPOSE_PROJECT_NAME="$PROD_PROJECT" \
      ./deploy.sh --host-port "$HOST_PORT" --project-name "$PROD_PROJECT" --detach
  ); then
    LAST_UPGRADE_ERROR="Production deploy failed"
    return 1
  fi

  set_status "health_check"
  if ! wait_for_health "$HOST_PORT" "Production"; then
    LAST_UPGRADE_ERROR="Production health check failed"
    return 1
  fi

  if docker image inspect "${IMAGE_NAME}:stable" >/dev/null 2>&1; then
    docker tag "${IMAGE_NAME}:stable" "${IMAGE_NAME}:rollback"
  fi
  docker tag "${IMAGE_NAME}:${release_tag}" "${IMAGE_NAME}:stable"
  save_release_state "$release_tag"
  mark_success "$target_commit"
  log "Update completed successfully"
  return 0
}

finish_failed_upgrade() {
  local production_failed=0
  if [[ "$LAST_UPGRADE_ERROR" == *"Production"* ]]; then
    production_failed=1
  fi
  teardown_staging
  if [[ "$production_failed" -eq 1 ]]; then
    log "Production health check failed; initiating rollback"
    if rollback_production; then
      exit 1
    fi
    set_status "failed" "Production health check failed and rollback did not recover"
    exit 1
  fi
  set_status "failed" "$LAST_UPGRADE_ERROR"
  exit 1
}

rollback_production() {
  log "Rolling back to ${IMAGE_NAME}:rollback"
  if ! docker image inspect "${IMAGE_NAME}:rollback" >/dev/null 2>&1; then
    log "No rollback image available"
    return 1
  fi
  deploy_production "rollback"
  if wait_for_health "$HOST_PORT" "Rollback"; then
    mark_rolled_back "Upgrade failed; restored previous release"
    return 0
  fi
  mark_rolled_back "Rollback deploy started but health check failed"
  return 1
}

run_rollback_trigger() {
  log "Starting manual Forge rollback"
  set_status "cutover"
  ensure_container_runtime
  if ! ensure_rollback_image; then
    set_status "failed" "No rollback image is available"
    exit 1
  fi
  if rollback_production; then
    exit 0
  fi
  set_status "failed" "Rollback failed health check"
  exit 1
}

ensure_container_runtime() {
  if load_common_sh; then
    export_compose_env
  fi
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if load_common_sh; then
    start_podman_api_service || return 1
    return 0
  fi
  start_podman_api_inline
}

git_in_source() {
  git -C "$SOURCE_DIR" "$@"
}

normalize_source_permissions() {
  # The updater sidecar runs without userns keep-id (FORGE_RUN_AS_ROOT=1). In that
  # namespace, container root (uid 0) maps to the host user. The main Forge app uses
  # keep-id, where the node user is that same host uid. Chowning to node:node here
  # remaps through /etc/subuid and leaves forge-source owned by a different numeric
  # uid (often seen as 999 in the app), so recovery agents cannot write FETCH_HEAD
  # ("Permission denied"). Keep ownership as root in the sidecar instead.
  if [[ "${FORGE_RUN_AS_ROOT:-}" == "1" ]]; then
    chown -R root:root "$SOURCE_DIR" 2>/dev/null || true
    return 0
  fi
  chown -R node:node "$SOURCE_DIR" 2>/dev/null || true
}

run_upgrade() {
  local repo="${FORGE_SELF_REPO:-}"
  local branch="${FORGE_SELF_BRANCH:-main}"
  if [[ -z "$repo" ]]; then
    set_status "failed" "FORGE_SELF_REPO is not configured"
    exit 1
  fi

  log "Starting Forge upgrade for ${repo}@${branch}"
  set_status "pulling"
  ensure_container_runtime
  log "Container runtime is ready"

  if declare -F pick_free_port >/dev/null; then
    STAGING_PORT="$(pick_free_port "$STAGING_PORT")"
    export FORGE_STAGING_PORT="$STAGING_PORT"
    log "Using staging port ${STAGING_PORT}"
  fi

  local previous_commit
  previous_commit="$(read_release_commit)"
  forge_db_set_previous_commit "$previous_commit"

  mkdir -p "$SOURCE_DIR"
  if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
    log "Cloning https://github.com/${repo}.git (branch ${branch})"
    if ! git clone --branch "$branch" "https://github.com/${repo}.git" "$SOURCE_DIR"; then
      set_status "failed" "Failed to clone https://github.com/${repo}.git (branch ${branch})"
      exit 1
    fi
  else
    log "Fetching latest changes for ${repo}@${branch}"
    if ! git_in_source fetch origin "$branch"; then
      set_status "failed" "Failed to fetch ${repo}@${branch} from GitHub"
      exit 1
    fi
    if ! git_in_source checkout "$branch" 2>/dev/null \
      && ! git_in_source checkout -B "$branch" "origin/${branch}"; then
      set_status "failed" "Failed to checkout branch ${branch} in ${SOURCE_DIR}"
      exit 1
    fi
    if ! git_in_source reset --hard "origin/${branch}"; then
      set_status "failed" "Failed to reset ${SOURCE_DIR} to origin/${branch}"
      exit 1
    fi
  fi

  normalize_source_permissions

  if ! load_common_sh; then
    set_status "failed" "Forge source is missing scripts/lib/common.sh"
    exit 1
  fi

  local target_commit
  target_commit="$(git_in_source rev-parse HEAD)"
  log "Target commit: ${target_commit}"

  if [[ -n "$previous_commit" && "$target_commit" == "$previous_commit" ]]; then
    log "Redeploying the same commit (${target_commit:0:7}); rebuilding from source"
  fi

  if ! ensure_rollback_image; then
    log "Warning: could not snapshot rollback image; proceeding without rollback safety net"
  fi

  local attempt
  for attempt in 1 2; do
    if build_test_stage_and_cutover "$target_commit"; then
      return 0
    fi
    if [[ "$attempt" -eq 1 ]] && attempt_forge_recovery "$LAST_UPGRADE_ERROR"; then
      target_commit="$(git_in_source rev-parse HEAD)"
      log "Retrying upgrade after recovery (attempt 2)"
      continue
    fi
    finish_failed_upgrade
  done
}

if [[ "$ROLLBACK" -eq 1 ]]; then
  log "Forge self-update orchestrator started (rollback)"
  run_rollback_trigger
else
  log "Forge self-update orchestrator started (upgrade)"
  run_upgrade
fi
