#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh

usage() {
  cat <<EOF
Usage: ./teardown.sh [options]

Stop containers and local processes started by deploy.sh.

$(common_usage)

Options:
  --volumes             Remove compose volumes (docker compose down -v)
  --no-remove-orphans   Skip --remove-orphans on compose down
EOF
}

REMAINING_ARGS=()
if ! parse_common_args "$@"; then
  usage
  exit 0
fi

while [[ ${#REMAINING_ARGS[@]} -gt 0 ]]; do
  case "${REMAINING_ARGS[0]}" in
    --volumes)
      REMOVE_VOLUMES=1
      REMAINING_ARGS=("${REMAINING_ARGS[@]:1}")
      ;;
    --no-remove-orphans)
      REMOVE_ORPHANS=0
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

stop_pid_file

if has_compose_file; then
  down_args=(down)
  if [[ "$REMOVE_VOLUMES" -eq 1 ]]; then
    down_args+=(-v)
  fi
  if [[ "$REMOVE_ORPHANS" -eq 1 ]]; then
    down_args+=(--remove-orphans)
  fi
  compose_cmd "${down_args[@]}"
fi

echo "Teardown complete."
