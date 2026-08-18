#!/usr/bin/env bash
# Layer B: bind-mounted workspace looks like root:root in the agent image (rootless
# Podman). USER agent cannot write .git/index.lock → git exit 128. Running as
# --user 0:0 matches the mapped owner so checkout succeeds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/test/harness/lib.sh
source "$SCRIPT_DIR/lib.sh"

if ! docker info >/dev/null 2>&1; then
  echo "skip: docker unavailable for agent-container-git-bind harness"
  exit 0
fi

if ! docker image inspect forge-agent:latest >/dev/null 2>&1; then
  docker build --network host \
    -f "$REPO_ROOT/docker/agent/Dockerfile" \
    -t forge-agent:latest \
    "$REPO_ROOT/docker/agent"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WORK="$TMP/repo"
git init -q "$WORK"
git -C "$WORK" checkout -q -b main
git -C "$WORK" config user.email "test@example.com"
git -C "$WORK" config user.name "Test"
git -C "$WORK" commit -q --allow-empty -m init

# Default image user (agent / 1000) cannot lock .git on a host-owned bind.
set +e
out="$(docker run --rm --entrypoint /bin/bash \
  -v "$WORK:/workspace/repo:z" \
  forge-agent:latest \
  -c 'git -C /workspace/repo checkout main' 2>&1)"
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  echo "EXPECTED git checkout as USER agent to fail on bind-mounted repo, got success" >&2
  echo "$out" >&2
  exit 1
fi
if [[ "$code" -ne 128 ]]; then
  echo "EXPECTED git exit 128 as USER agent, got $code: $out" >&2
  exit 1
fi

if ! docker run --rm --user 0:0 --entrypoint /bin/bash \
  -v "$WORK:/workspace/repo:z" \
  forge-agent:latest \
  -c 'git config --global --add safe.directory "*"; git -C /workspace/repo checkout main'; then
  echo "EXPECTED git checkout as --user 0:0 to succeed on bind-mounted repo" >&2
  exit 1
fi

echo "ok: bind-mounted git checkout needs --user 0:0 (else 128)"
