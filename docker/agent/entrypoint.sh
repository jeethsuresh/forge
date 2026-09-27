#!/usr/bin/env bash
# Clone project branch, optional packages, run agent CLI, heartbeat to Ops.
set -euo pipefail

OPS_BASE="${FORGE_OPS_API_BASE:?FORGE_OPS_API_BASE required}"
OPS_TOKEN="${FORGE_OPS_API_TOKEN:?FORGE_OPS_API_TOKEN required}"
SESSION_ID="${FORGE_AGENT_SESSION_ID:?FORGE_AGENT_SESSION_ID required}"
PROJECT_ID="${FORGE_AGENT_PROJECT_ID:?FORGE_AGENT_PROJECT_ID required}"
BRANCH="${FORGE_AGENT_BRANCH:?FORGE_AGENT_BRANCH required}"
CLONE_URL="${FORGE_AGENT_CLONE_URL:?FORGE_AGENT_CLONE_URL required}"
INTERVAL="${FORGE_AGENT_HEARTBEAT_INTERVAL_SEC:-10}"
AGENT_BIN="${FORGE_AGENT_BIN:-/usr/local/bin/agent}"
WORKDIR="${FORGE_AGENT_WORKDIR:-/workspace/repo}"

heartbeat_loop() {
  while true; do
    curl -fsS -X POST \
      -H "Authorization: Bearer ${OPS_TOKEN}" \
      -H "Content-Type: application/json" \
      -H "X-Forge-Agent-Session-Id: ${SESSION_ID}" \
      -d "{\"actionDescription\":\"Agent heartbeat for session ${SESSION_ID}.\"}" \
      "${OPS_BASE}/api/ops/projects/${PROJECT_ID}/agent-sessions/${SESSION_ID}/heartbeat" \
      >/dev/null 2>&1 || true
    sleep "${INTERVAL}"
  done
}

post_event() {
  local payload="$1"
  curl -fsS -X POST \
    -H "Authorization: Bearer ${OPS_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-Forge-Agent-Session-Id: ${SESSION_ID}" \
    -d "{\"actionDescription\":\"Agent event ingest for session ${SESSION_ID}.\",\"events\":[${payload}]}" \
    "${OPS_BASE}/api/ops/projects/${PROJECT_ID}/agent-sessions/${SESSION_ID}/events" \
    >/dev/null 2>&1 || true
}

configure_git() {
  if [[ -n "${FORGE_GIT_USERNAME:-}" && -n "${FORGE_GIT_PASSWORD:-}" ]]; then
    local encoded_user encoded_pass
    encoded_user=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ['FORGE_GIT_USERNAME'], safe=''))")
    encoded_pass=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ['FORGE_GIT_PASSWORD'], safe=''))")
    case "${CLONE_URL}" in
      https://*)
        CLONE_URL="https://${encoded_user}:${encoded_pass}@${CLONE_URL#https://}"
        ;;
      http://*)
        CLONE_URL="http://${encoded_user}:${encoded_pass}@${CLONE_URL#http://}"
        ;;
    esac
  fi
  git config --global --add safe.directory '*'
  if [[ -n "${FORGE_GIT_BARE_PATH:-}" ]]; then
    git config --global --add safe.directory "${FORGE_GIT_BARE_PATH}" || true
  fi
}

use_forge_bare_origin() {
  if [[ -z "${FORGE_GIT_BARE_PATH:-}" || ! -d "${FORGE_GIT_BARE_PATH}" ]]; then
    return 0
  fi
  if [[ ! -d "${WORKDIR}/.git" ]]; then
    return 0
  fi
  local origin
  origin="$(git -C "${WORKDIR}" remote get-url origin 2>/dev/null || true)"
  case "${origin}" in
    http://*|https://*)
      if [[ "${origin}" == *"/api/git/"* && "${origin}" != *"@"* ]]; then
        git -C "${WORKDIR}" remote set-url origin "${FORGE_GIT_BARE_PATH}"
      fi
      ;;
    "")
      git -C "${WORKDIR}" remote add origin "${FORGE_GIT_BARE_PATH}"
      ;;
  esac
}

clone_repo() {
  mkdir -p "${WORKDIR}"
  git config --global --add safe.directory "${WORKDIR}" || true

  if [[ -d "${WORKDIR}/.git" ]]; then
    cd "${WORKDIR}"
    use_forge_bare_origin
    git fetch --all --prune 2>/dev/null || true
    if ! git checkout "${BRANCH}" 2>/dev/null; then
      git checkout -B "${BRANCH}"
    fi
    return 0
  fi

  # Bind-mounted workspaces are non-empty; never rm -rf the mount point.
  if [[ -n "$(ls -A "${WORKDIR}" 2>/dev/null || true)" ]]; then
    echo "Workspace ${WORKDIR} is not a git checkout; using as-is (no clone)." >&2
    cd "${WORKDIR}"
    return 0
  fi

  git clone --branch "${BRANCH}" --single-branch "${CLONE_URL}" "${WORKDIR}"
  cd "${WORKDIR}"
}

install_packages() {
  local packages_json="${FORGE_AGENT_PACKAGES_JSON:-}"
  if [[ -z "${packages_json}" || "${packages_json}" == "[]" ]]; then
    return 0
  fi
  # Best-effort apt/npm hints from Forgefile agent.packages (non-secret).
  echo "agent.packages present; install manually via Ops if needed: ${packages_json}"
}

run_agent() {
  cd "${WORKDIR}"
  local prompt
  if [[ -n "${FORGE_AGENT_PROMPT_FILE:-}" && -f "${FORGE_AGENT_PROMPT_FILE}" ]]; then
    # Do not cat the file into argv: Linux MAX_ARG_STRLEN is 128KiB.
    prompt="Read ${FORGE_AGENT_PROMPT_FILE} and follow those instructions exactly. Treat the file contents as the full prompt for this turn."
  else
    prompt="${FORGE_AGENT_PROMPT:-Continue the Forge agent session.}"
  fi
  if [[ ! -x "${AGENT_BIN}" ]]; then
    post_event "{\"type\":\"system\",\"subtype\":\"error\",\"text\":\"Agent binary missing at ${AGENT_BIN}\"}"
    echo "Agent binary not found at ${AGENT_BIN}" >&2
    exit 127
  fi
  local resume_args=()
  if [[ -n "${FORGE_CURSOR_SESSION_ID:-}" ]]; then
    resume_args=(--resume "${FORGE_CURSOR_SESSION_ID}")
  fi
  # Stream JSON lines to Ops event ingest (UI must not depend on docker logs).
  "${AGENT_BIN}" -p --force --output-format stream-json --stream-partial-output \
    "${resume_args[@]}" "${prompt}" \
    | while IFS= read -r line; do
        [[ -z "${line}" ]] && continue
        # Escape for JSON string embedding
        local escaped
        escaped=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "${line}")
        post_event "{\"type\":\"stream\",\"line\":${escaped}}"
      done
}

configure_git
clone_repo
install_packages
heartbeat_loop &
HB_PID=$!
trap 'kill ${HB_PID} 2>/dev/null || true' EXIT
run_agent
