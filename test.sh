#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Never lock the production SQLite file during unit tests (including self-update).
# Re-assert after sourcing .env so a host FORGE_DB_PATH cannot leak into vitest.
export FORGE_DB_PATH=":memory:"

usage() {
  cat <<EOF
Usage: ./test.sh [options]

Run unit tests for Forge or a compose-based project test service.

$(common_usage)

Options:
  --watch               Run vitest in watch mode
  --coverage            Run vitest with coverage (when configured)
  --live-smoke          Enable Layer C live Forge Redeploy / smoke tests
  --ui-e2e              Run Playwright studio e2e (also auto-runs when Forge health is up)
EOF
}

WATCH=0
COVERAGE=0
LIVE_SMOKE=0
UI_E2E=0
REMAINING_ARGS=()
if ! parse_common_args "$@"; then
  usage
  exit 0
fi

while [[ ${#REMAINING_ARGS[@]} -gt 0 ]]; do
  case "${REMAINING_ARGS[0]}" in
    --watch)
      WATCH=1
      REMAINING_ARGS=("${REMAINING_ARGS[@]:1}")
      ;;
    --coverage)
      COVERAGE=1
      REMAINING_ARGS=("${REMAINING_ARGS[@]:1}")
      ;;
    --live-smoke)
      LIVE_SMOKE=1
      REMAINING_ARGS=("${REMAINING_ARGS[@]:1}")
      ;;
    --ui-e2e)
      UI_E2E=1
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

# Layer C enablement: explicit flag, or auto when an agent ops token is present.
# Never nest live cutover inside the self-updater staging test.sh.
if [[ "${FORGE_LIVE_SMOKE:-}" != "0" ]]; then
  if [[ "$LIVE_SMOKE" -eq 1 ]]; then
    export FORGE_LIVE_SMOKE=1
  elif [[ -z "${FORGE_UPDATE_ID:-}" && "${FORGE_UPDATER:-}" != "1" && "${COMPOSE_PROJECT_NAME:-}" != *staging* ]]; then
    token="${FORGE_OPS_API_TOKEN:-}"
    if [[ "$token" == fos.* && -n "${FORGE_OPS_API_BASE:-}" ]]; then
      export FORGE_LIVE_SMOKE=1
      echo "[test.sh] Agent ops context detected — enabling live smoke (FORGE_LIVE_SMOKE=1)"
    fi
  fi
fi

# Prefer host vitest when node_modules is present (fresh local sources). Use the
# Dockerfile test target when deps aren't installed or FORGE_COMPOSE_TESTS=1
# (self-update staging typically lacks host node_modules).
if has_compose_file && { [[ "${FORGE_COMPOSE_TESTS:-}" == "1" ]] || [[ ! -d node_modules ]]; }; then
  test_tag="forge-test:${FORGE_COMMIT_SHA:-local}"
  docker build --network host \
    -f Dockerfile \
    --target test \
    -t "$test_tag" \
    .
  docker run --rm \
    -e FORGE_DB_PATH=:memory: \
    -e FORGE_UPDATE_ID="${FORGE_UPDATE_ID:-}" \
    -e FORGE_UPDATER="${FORGE_UPDATER:-}" \
    -e FORGE_LIVE_SMOKE=0 \
    -e FORGE_UI_E2E=0 \
    -e COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}" \
    "$test_tag"
  exit 0
fi

if [[ "$WATCH" -eq 1 ]]; then
  npm run test:watch
elif [[ "$COVERAGE" -eq 1 ]]; then
  npm run test -- --coverage
else
  npm test
fi

run_playwright_e2e() {
  if [[ "${FORGE_UI_E2E:-}" == "0" ]]; then
    return 0
  fi
  if [[ -n "${FORGE_UPDATE_ID:-}" || "${FORGE_UPDATER:-}" == "1" || "${COMPOSE_PROJECT_NAME:-}" == *staging* ]]; then
    return 0
  fi
  local base="http://127.0.0.1:${HOST_PORT:-3000}"
  if [[ -n "${FORGE_OPS_API_BASE:-}" ]]; then
    base="${FORGE_OPS_API_BASE%/}"
  fi
  if [[ "$UI_E2E" -ne 1 && "${FORGE_UI_E2E:-}" != "1" ]]; then
    if ! curl -sf --max-time 2 "$base/api/forge/health" 2>/dev/null | grep -q '"ok":true'; then
      return 0
    fi
  fi
  echo "[test.sh] Running Playwright studio e2e against $base"
  npx playwright install chromium
  FORGE_OPS_API_BASE="$base" npx playwright test
}

if [[ "$WATCH" -eq 0 ]]; then
  run_playwright_e2e
fi
