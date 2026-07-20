#!/usr/bin/env bash
# Layer B: build path must not proceed when container runtime probe fails.
# We assert export_compose_env / resolve path surfaces failure via docker info stub.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/test/harness/lib.sh
source "$SCRIPT_DIR/lib.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HARNESS_BIN="$TMP/bin"
export HARNESS_LOG="$TMP/log"
mkdir -p "$HARNESS_BIN" "$HARNESS_LOG"

export HARNESS_DOCKER_INFO_OK=0
harness_install_docker_stub
export PATH="$HARNESS_BIN:$PATH"
export DOCKER_HOST="tcp://127.0.0.1:19999"
export FORGE_PODMAN_API_PORT=19999

# Directly assert our stub reports unreachable the same way buildx-masked failures start.
if docker info >/dev/null 2>&1; then
  echo "EXPECTED docker info to fail under HARNESS_DOCKER_INFO_OK=0" >&2
  exit 1
fi

err="$(docker info 2>&1 || true)"
if ! grep -qi 'Cannot connect to the Docker daemon' <<<"$err"; then
  echo "EXPECTED clear daemon connection error, got: $err" >&2
  exit 1
fi
if grep -qi 'Install the buildx component' <<<"$err"; then
  echo "UNEXPECTED buildx-only failure masking" >&2
  exit 1
fi

echo "ok: runtime probe fails with clear daemon error (not buildx-only)"
