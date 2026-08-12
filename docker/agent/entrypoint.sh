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
    # Embed credentials for HTTPS clone (interim GitHub or Forge HTTP).
    local encoded_user encoded_pass
    encoded_user=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ['FORGE_GIT_USERNAME'], safe=''))")
    encoded_pass=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ['FORGE_GIT_PASSWORD'], safe=''))")
    if [[ "${CLONE_URL}" =~ ^https:// ]]; then
      CLONE_URL="https://${encoded_user}:${encoded_pass}@${CLONE_URL#https://}"
    fi
  fi
  git config --global --add safe.directory '*'
}

clone_repo() {
  if [[ -d "${WORKDIR}/.git" ]]; then
    cd "${WORKDIR}"
    git fetch --all --prune 2>/dev/null || true
    git checkout "${BRANCH}" 2>/dev/null || git checkout -B "${BRANCH}"
    return 0
  fi
  rm -rf "${WORKDIR}"
  mkdir -p "$(dirname "${WORKDIR}")"
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
  local prompt="${FORGE_AGENT_PROMPT:-Continue the Forge agent session.}"
  if [[ ! -x "${AGENT_BIN}" ]]; then
    post_event "{\"type\":\"system\",\"subtype\":\"error\",\"text\":\"Agent binary missing at ${AGENT_BIN}\"}"
    echo "Agent binary not found at ${AGENT_BIN}" >&2
    exit 127
  fi
  # Stream JSON lines to Ops event ingest (UI must not depend on docker logs).
  "${AGENT_BIN}" -p --force --output-format stream-json --stream-partial-output "${prompt}" \
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
