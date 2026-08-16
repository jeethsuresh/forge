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
  source_sha="$(git rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$source_sha" ]]; then
    source_sha="$(date -Iseconds)"
  fi
  export FORGE_COMMIT_SHA="${FORGE_COMMIT_SHA:-$source_sha}"
  local_tag="${FORGE_COMMIT_SHA}"
  # Podman/BuildKit compose bake rejects `network.host` entitlement; CLI
  # `compose build --network host` is rejected by podman-compose. Plain
  # `docker build --network host` is what succeeds on this host.
  docker build --network host --no-cache \
    -f Dockerfile \
    --target runner \
    --build-arg "SOURCE_SHA=${local_tag}" \
    -t "forge-app:${local_tag}" \
    .
  docker tag "forge-app:${local_tag}" forge-app:stable
  if ! docker image inspect forge-app:rollback >/dev/null 2>&1; then
    docker tag "forge-app:${local_tag}" forge-app:rollback
  fi
  # Agent session containers (not published to a registry).
  docker build --network host \
    -f docker/agent/Dockerfile \
    -t "${FORGE_AGENT_IMAGE:-forge-agent:latest}" \
    docker/agent
  exit 0
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  npm ci
fi

if [[ "$SKIP_LINT" -eq 0 ]]; then
  npm run lint
fi

npm run build
