#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh

usage() {
  cat <<EOF
Usage: ./build.sh [options]

Build Forge or a compose-based project.

$(common_usage)

Options:
  --skip-install        Skip npm ci
  --skip-lint           Skip npm run lint
EOF
}

REMAINING_ARGS=()
if ! parse_common_args "$@"; then
  usage
  exit 0
fi

while [[ ${#REMAINING_ARGS[@]} -gt 0 ]]; do
  case "${REMAINING_ARGS[0]}" in
    --skip-install)
      SKIP_INSTALL=1
      REMAINING_ARGS=("${REMAINING_ARGS[@]:1}")
      ;;
    --skip-lint)
      SKIP_LINT=1
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
  compose_cmd build
  compose_cmd create --no-build
  image_id="$(resolve_compose_app_image_id || true)"
  if [[ -n "$image_id" ]]; then
    docker tag "$image_id" forge-app:stable
    if ! docker image inspect forge-app:rollback >/dev/null 2>&1; then
      docker tag "$image_id" forge-app:rollback
    fi
  fi
  exit 0
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  npm ci
fi

if [[ "$SKIP_LINT" -eq 0 ]]; then
  npm run lint
fi

npm run build
