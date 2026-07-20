#!/usr/bin/env bash
# Layer B: normalize_source_permissions chowns root:root under FORGE_RUN_AS_ROOT=1.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/test/harness/lib.sh
source "$SCRIPT_DIR/lib.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HARNESS_BIN="$TMP/bin"
export HARNESS_LOG="$TMP/log"
mkdir -p "$HARNESS_BIN" "$HARNESS_LOG"
harness_install_chown_recorder
export PATH="$HARNESS_BIN:$PATH"

SOURCE_DIR="$TMP/forge-source"
mkdir -p "$SOURCE_DIR/.git"
echo "ref: refs/heads/main" >"$SOURCE_DIR/.git/HEAD"

# Extract and run normalize_source_permissions from self-update.sh in isolation.
# shellcheck disable=SC1091
eval "$(
  sed -n '/^normalize_source_permissions()/,/^}/p' \
    "$REPO_ROOT/scripts/self-update.sh"
)"

export FORGE_RUN_AS_ROOT=1
normalize_source_permissions

if [[ ! -f "$HARNESS_LOG/chown.argv" ]]; then
  echo "EXPECTED chown to be invoked" >&2
  exit 1
fi

if ! grep -q 'root:root' "$HARNESS_LOG/chown.argv"; then
  echo "EXPECTED chown root:root under FORGE_RUN_AS_ROOT=1" >&2
  cat "$HARNESS_LOG/chown.argv" >&2
  exit 1
fi

if grep -q 'node:node' "$HARNESS_LOG/chown.argv"; then
  echo "UNEXPECTED chown node:node under FORGE_RUN_AS_ROOT=1" >&2
  exit 1
fi

# Recovery path must call normalize before agent fetch (static + runtime check).
SCRIPT="$REPO_ROOT/scripts/self-update.sh"
if ! grep -A80 'attempt_forge_recovery()' "$SCRIPT" | grep -q 'normalize_source_permissions'; then
  echo "EXPECTED attempt_forge_recovery to call normalize_source_permissions" >&2
  exit 1
fi

echo "ok: normalize_source_permissions uses root:root and recovery calls it"
