#!/usr/bin/env bash
# Layer B: agent session containers need a local forge-agent image and host-path
# workspace binds (not in-container /data paths that Podman treats as host paths).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/test/harness/lib.sh
source "$SCRIPT_DIR/lib.sh"

if ! docker info >/dev/null 2>&1; then
  echo "skip: docker unavailable for agent-container-startup harness"
  exit 0
fi

if ! docker image inspect forge-agent:latest >/dev/null 2>&1; then
  echo "[harness] Building forge-agent:latest (missing locally)"
  docker build --network host \
    -f "$REPO_ROOT/docker/agent/Dockerfile" \
    -t forge-agent:latest \
    "$REPO_ROOT/docker/agent"
fi

TMP="$(mktemp -d)"
trap 'docker rm -f forge-harness-agent-startup >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

WORK="$TMP/workspace"
mkdir -p "$WORK"
echo "forge-agent-bind-ok" >"$WORK/marker.txt"

# Host bind must succeed (regression: -v /data/repos/... from inside Forge → mkdir /data denied).
if ! docker run --rm \
  --name forge-harness-agent-startup \
  --entrypoint /bin/bash \
  -v "$WORK:/workspace/repo:z" \
  forge-agent:latest \
  -c 'test -f /workspace/repo/marker.txt'; then
  echo "EXPECTED host workspace bind to work under /workspace/repo" >&2
  exit 1
fi

# In-container /data path on the host must not work as a bind source.
if docker run --rm \
  --entrypoint /bin/bash \
  -v "/data/forge-harness-missing:/workspace/repo:z" \
  forge-agent:latest \
  -c 'test -f /workspace/repo/marker.txt' 2>/dev/null; then
  echo "UNEXPECTED /data bind source to succeed on host" >&2
  exit 1
fi

echo "ok: forge-agent image present and host workspace bind works"
