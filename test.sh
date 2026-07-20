#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh

# Never lock the production SQLite file during unit tests (including self-update).
export FORGE_DB_PATH="${FORGE_DB_PATH:-:memory:}"

usage() {
  cat <<EOF
Usage: ./test.sh [options]

Run unit tests for Forge or a compose-based project test service.

$(common_usage)

Options:
  --watch               Run vitest in watch mode
  --coverage            Run vitest with coverage (when configured)
  --live-smoke          Enable Layer C live Forge Redeploy / smoke tests
EOF
}

WATCH=0
COVERAGE=0
LIVE_SMOKE=0
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
# compose test profile when deps aren't installed or FORGE_COMPOSE_TESTS=1
# (self-update staging typically lacks host node_modules and rebuilds via Dockerfile).
if has_compose_file && { [[ "${FORGE_COMPOSE_TESTS:-}" == "1" ]] || [[ ! -d node_modules ]]; }; then
  compose_cmd --profile test run --rm test
  exit 0
fi

if [[ "$WATCH" -eq 1 ]]; then
  npm run test:watch
elif [[ "$COVERAGE" -eq 1 ]]; then
  npm run test -- --coverage
else
  npm test
fi
