#!/usr/bin/env bash
# Retry npm ci for transient node-gyp / registry timeouts.
# Used by Dockerfile deps stage and Layer B harness tests.

npm_ci_with_retry() {
  local max="${NPM_CI_MAX_ATTEMPTS:-5}"
  local sleep_s="${NPM_CI_RETRY_SLEEP:-20}"
  local attempt=1
  npm config set fetch-retries 5 >/dev/null 2>&1 || true
  npm config set fetch-retry-mintimeout 20000 >/dev/null 2>&1 || true
  npm config set fetch-retry-maxtimeout 120000 >/dev/null 2>&1 || true
  while true; do
    if npm ci; then
      return 0
    fi
    if (( attempt >= max )); then
      echo "npm ci failed after ${max} attempts" >&2
      return 1
    fi
    echo "npm ci attempt ${attempt} failed; retrying in ${sleep_s}s…" >&2
    if [[ "${sleep_s}" != "0" ]]; then
      sleep "${sleep_s}"
    fi
    attempt=$((attempt + 1))
  done
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  npm_ci_with_retry
fi
