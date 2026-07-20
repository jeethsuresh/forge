#!/usr/bin/env bash
# Shell harness helpers for Layer B resilience tests.
# Sourced by vitest-driven scripts under scripts/test/harness/*.sh
set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HARNESS_ROOT/../../.." && pwd)"

# Write a stub binary that records argv and optionally exits.
# Usage: harness_install_stub NAME [exit_code] [stdout]
harness_install_stub() {
  local name="$1"
  local exit_code="${2:-0}"
  local stdout="${3:-}"
  local bin_dir="${HARNESS_BIN:?}"
  mkdir -p "$bin_dir"
  cat >"$bin_dir/$name" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"${HARNESS_LOG:?}/${name}.argv"
if [[ -n "$stdout" ]]; then
  printf '%s' "$stdout"
fi
exit $exit_code
EOF
  chmod +x "$bin_dir/$name"
}

# docker stub: "info" succeeds when HARNESS_DOCKER_INFO_OK=1, else fails.
harness_install_docker_stub() {
  local bin_dir="${HARNESS_BIN:?}"
  mkdir -p "$bin_dir" "${HARNESS_LOG:?}"
  cat >"$bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${HARNESS_LOG}/docker.argv"
case "${1:-}" in
  info)
    if [[ "${HARNESS_DOCKER_INFO_OK:-0}" == "1" ]]; then
      exit 0
    fi
    echo "Cannot connect to the Docker daemon" >&2
    exit 1
    ;;
  *)
    exit 0
    ;;
esac
EOF
  chmod +x "$bin_dir/docker"
}

harness_install_chown_recorder() {
  local bin_dir="${HARNESS_BIN:?}"
  mkdir -p "$bin_dir" "${HARNESS_LOG:?}"
  cat >"$bin_dir/chown" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${HARNESS_LOG}/chown.argv"
exit 0
EOF
  chmod +x "$bin_dir/chown"
}
