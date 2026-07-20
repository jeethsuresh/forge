#!/usr/bin/env bash
# Layer B: resolve_docker_socket trusts configured path when TCP is ready but -S fails.
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

# Fake configured socket path that is NOT a real socket (-S fails).
FAKE_SOCK="$TMP/not-a-socket"
echo "placeholder" >"$FAKE_SOCK"
export DOCKER_SOCKET="$FAKE_SOCK"
export FORGE_PODMAN_API_PORT="${FORGE_PODMAN_API_PORT:-18765}"
export PATH="$HARNESS_BIN:$PATH"

# shellcheck source=scripts/lib/common.sh
source "$REPO_ROOT/scripts/lib/common.sh"

resolved="$(resolve_docker_socket)"
if [[ "$resolved" != "$FAKE_SOCK" ]]; then
  echo "EXPECTED configured socket path when TCP ready; got: $resolved" >&2
  exit 1
fi

echo "ok: resolve_docker_socket returned configured path under TCP-ready stub"
