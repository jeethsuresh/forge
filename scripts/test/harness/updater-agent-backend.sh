#!/usr/bin/env bash
# Updater sidecar must not publish in-container stub dirs as compose bind sources.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/test/harness/lib.sh
source "$SCRIPT_DIR/lib.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
# Hide any host codex/cursor CLIs. python3 must remain visible for mount persistence.
export PATH="$TMP/bin:/usr/bin:/bin"

unset FORGE_CODEX_DIR OPENAI_API_KEY CODEX_API_KEY \
  FORGE_LOCAL_AGENT_BASE_URL FORGE_LOCAL_AGENT_MODEL \
  FORGE_CURSOR_API_KEY CURSOR_API_KEY || true

export FORGE_UPDATER=1
export FORGE_HOST_MOUNTS_FILE="$TMP/mounts.json"
export FORGE_RUNTIME_ENV_FILE="$TMP/missing-runtime.env"
export FORGE_CURSOR_AGENT_DIR="$TMP/host-cursor-agent"
export FORGE_CURSOR_CONFIG_DIR="$TMP/host-cursor-config"

# shellcheck source=scripts/lib/common.sh
source "$REPO_ROOT/scripts/lib/common.sh"

require_any_agent_backend

if [[ -n "${FORGE_CODEX_DIR:-}" ]]; then
  echo "updater set FORGE_CODEX_DIR to a stub or container path: ${FORGE_CODEX_DIR}" >&2
  exit 1
fi

if [[ "$FORGE_CURSOR_AGENT_DIR" != "$TMP/host-cursor-agent" ]]; then
  echo "updater replaced host cursor dir: ${FORGE_CURSOR_AGENT_DIR}" >&2
  exit 1
fi

if [[ "$FORGE_CURSOR_CONFIG_DIR" != "$TMP/host-cursor-config" ]]; then
  echo "updater replaced host cursor config dir: ${FORGE_CURSOR_CONFIG_DIR}" >&2
  exit 1
fi

if [[ ! -f "$FORGE_HOST_MOUNTS_FILE" ]]; then
  echo "expected persisted host mounts file" >&2
  exit 1
fi

echo "ok: updater kept host cursor binds and left codex unset"
