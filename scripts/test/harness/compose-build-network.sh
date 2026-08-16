#!/usr/bin/env bash
# Layer B: compose build must use host network so npm ci / node-gyp can
# reach nodejs.org (BuildKit's default isolation ETIMEDOUTs on this host).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/test/harness/lib.sh
source "$SCRIPT_DIR/lib.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HARNESS_BIN="$TMP/bin"
export HARNESS_LOG="$TMP/log"
mkdir -p "$HARNESS_BIN" "$HARNESS_LOG"

export HARNESS_DOCKER_INFO_OK=1
harness_install_docker_stub
export PATH="$HARNESS_BIN:$PATH"

export COMPOSE_PROJECT_NAME="forge-harness-$$"
export FORGE_CURSOR_AGENT_DIR="$TMP/cursor-agent"
export FORGE_CURSOR_CONFIG_DIR="$TMP/cursor-config"
export FORGE_HOST_MOUNTS_FILE="$TMP/forge-host-mounts.json"
mkdir -p "$FORGE_CURSOR_AGENT_DIR" "$FORGE_CURSOR_CONFIG_DIR"
touch "$FORGE_CURSOR_AGENT_DIR/cursor-agent"

cd "$REPO_ROOT"
# shellcheck source=scripts/lib/common.sh
source "$REPO_ROOT/scripts/lib/common.sh"

compose_cmd build --no-cache --build-arg SOURCE_SHA=deadbeef >/dev/null

argv="$(cat "$HARNESS_LOG/docker.argv")"
if ! grep -q 'compose .* build ' <<<"$argv"; then
  echo "EXPECTED docker compose build invocation, got:" >&2
  echo "$argv" >&2
  exit 1
fi
if ! grep -Eq 'build --network host|--network host .*build' <<<"$argv"; then
  echo "EXPECTED compose build --network host, got:" >&2
  echo "$argv" >&2
  exit 1
fi

echo "ok: compose build uses host network"
