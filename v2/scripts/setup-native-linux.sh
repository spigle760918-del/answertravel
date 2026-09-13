#!/usr/bin/env bash
# For a copied, isolated verification workspace only. No system installation.
set -euo pipefail
if [[ $(id -u) == 0 ]]; then
  printf 'Run as an unprivileged user in the prepared test directory.\n' >&2
  exit 1
fi
v2_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
case "$v2_dir" in /var/tmp/answertravel-v2-verify-*/v2) ;; *)
  printf 'Refusing: expected an isolated /var/tmp/answertravel-v2-verify-*/v2 directory.\n' >&2; exit 1 ;;
esac
cd "$v2_dir"
[[ $(uname -m) == x86_64 ]] || { printf 'x64 host required.\n'; exit 1; }
for tool in curl tar xz gzip gcc make sha256sum; do command -v "$tool" >/dev/null; done
mkdir -p .runtime/tools .runtime/npm-cache .runtime/tmp
tools_dir="$v2_dir/.runtime/tools"
export TMPDIR="$v2_dir/.runtime/tmp"
export npm_config_cache="$v2_dir/.runtime/npm-cache"
export NODE_OPTIONS=--max-old-space-size=512
umask 077
fetch_verified() {
  local name="$1" url="$2" expected="$3"
  if ! printf '%s  %s\n' "$expected" "$tools_dir/$name" | sha256sum --check --status 2>/dev/null; then
    curl --fail --location --connect-timeout 15 --max-time 180 --retry 1 "$url" --output "$tools_dir/$name"
  fi
  printf '%s  %s\n' "$expected" "$tools_dir/$name" | sha256sum --check
}
fetch_verified node-v24.21.0-linux-x64.tar.xz https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
tar -xJf "$tools_dir/node-v24.21.0-linux-x64.tar.xz" -C "$tools_dir"
export PATH="$tools_dir/node-v24.21.0-linux-x64/bin:$PATH"
node --version
npm ci --ignore-scripts --no-fund --no-audit
# Reviewed fixed-version installer only restores relative native library links.
(cd node_modules/@embedded-postgres/linux-x64 && node scripts/hydrate-symlinks.js)
fetch_verified redis-7.2.16.tar.gz https://download.redis.io/releases/redis-7.2.16.tar.gz 960a8ec15e34ff40e57ff16837b26b33bd81f2da6d24497bb63de532a323a18e
tar -xzf "$tools_dir/redis-7.2.16.tar.gz" -C "$tools_dir"
# One compilation process; never make install. Runtime/cgroup limits supplied externally.
make -C "$tools_dir/redis-7.2.16" -j1 MALLOC=libc OPT=-O2 REDIS_CFLAGS= REDIS_LDFLAGS= redis-server
"$tools_dir/redis-7.2.16/src/redis-server" --version
npm run verify:local
