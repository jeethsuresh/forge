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
EOF
}

WATCH=0
COVERAGE=0
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

if has_compose_file; then
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
