#!/usr/bin/env sh
# Run only after reviewing server-preflight.sh output on the designated test host.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
v2_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
cd "$v2_dir"
command -v docker >/dev/null 2>&1 || { printf 'Docker missing; no installation attempted.\n'; exit 1; }
docker compose version >/dev/null
available_kib=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
free_kib=$(df -Pk "$v2_dir" | awk 'NR==2 { print $4 }')
[ "$available_kib" -ge 2097152 ] || { printf 'Need at least 2 GiB available memory; stopped before starting test containers.\n'; exit 1; }
[ "$free_kib" -ge 4194304 ] || { printf 'Need at least 4 GiB free disk; stopped before starting test containers.\n'; exit 1; }
project="answertravel-v2-verify-$(date +%s)-$$"
case "$project" in answertravel-v2-verify-[0-9]*-[0-9]*) ;; *) exit 1 ;; esac
compose_file="$v2_dir/compose.verify.yaml"
cleanup() {
  # Unique project created by this invocation only; no host ports or external volumes.
  docker compose -p "$project" -f "$compose_file" down --volumes
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker compose -p "$project" -f "$compose_file" up --build --abort-on-container-exit --exit-code-from verifier
