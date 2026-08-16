#!/usr/bin/env bash
# Layer B: image builds must use `docker build --network host` so npm ci /
# node-gyp can reach nodejs.org. Compose bake + CLI --network both fail here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/test/harness/lib.sh
source "$SCRIPT_DIR/lib.sh"

if ! grep -q 'docker build --network host' "$REPO_ROOT/build.sh"; then
  echo "EXPECTED build.sh to call docker build --network host" >&2
  exit 1
fi
if grep -q 'compose_cmd build' "$REPO_ROOT/build.sh"; then
  echo "build.sh must not use compose_cmd build (podman-compose/bake break)" >&2
  exit 1
fi
if ! grep -A8 '^    build:' "$REPO_ROOT/docker-compose.yml" | grep -q 'network: host'; then
  echo "EXPECTED docker-compose.yml app build.network: host" >&2
  exit 1
fi

echo "ok: Forge image build uses docker build --network host"
