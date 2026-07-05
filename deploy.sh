#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh

usage() {
  cat <<EOF
Usage: ./deploy.sh [options]

Deploy Forge or a compose-based project.

$(common_usage)

Options:
  --detach              Run in background (default for npm start)
  --no-detach           Run in foreground
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

if has_compose_file; then
  compose_cmd up -d
  exit 0
fi

mkdir -p "$(dirname "$PID_FILE")"
stop_pid_file

export PORT="$HOST_PORT"
npm run build

if [[ "$DETACH" -eq 1 ]]; then
  nohup npm start > ./data/forge.log 2>&1 &
  echo $! > "$PID_FILE"
  echo "Forge started on port ${HOST_PORT} (pid $(cat "$PID_FILE"))"
else
  npm start
fi
