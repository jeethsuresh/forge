#!/usr/bin/env bash
# Layer B: npm ci wrapper retries transient node-gyp / registry timeouts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/test/harness/lib.sh
source "$SCRIPT_DIR/lib.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HARNESS_BIN="$TMP/bin"
export HARNESS_LOG="$TMP/log"
mkdir -p "$HARNESS_BIN" "$HARNESS_LOG"

# Fail twice with ETIMEDOUT, succeed on third.
cat >"$HARNESS_BIN/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${HARNESS_LOG}/npm.argv"
if [[ "${1:-}" != "ci" ]]; then
  exit 0
fi
count_file="${HARNESS_LOG}/npm.count"
n=0
if [[ -f "$count_file" ]]; then
  n="$(cat "$count_file")"
fi
n=$((n + 1))
echo "$n" >"$count_file"
if [[ "$n" -lt 3 ]]; then
  echo "npm error gyp http fetch GET https://nodejs.org/download/release/v20.20.2/node-v20.20.2-headers.tar.gz attempt 1 failed with ETIMEDOUT" >&2
  exit 1
fi
exit 0
EOF
chmod +x "$HARNESS_BIN/npm"
export PATH="$HARNESS_BIN:$PATH"
export NPM_CI_RETRY_SLEEP=0

# shellcheck source=scripts/lib/npm-ci.sh
source "$REPO_ROOT/scripts/lib/npm-ci.sh"
npm_ci_with_retry

count="$(cat "$HARNESS_LOG/npm.count")"
if [[ "$count" != "3" ]]; then
  echo "EXPECTED 3 npm ci attempts, got $count" >&2
  exit 1
fi

echo "ok: npm ci retries ETIMEDOUT then succeeds"
