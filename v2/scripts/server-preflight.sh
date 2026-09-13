#!/usr/bin/env sh
# Read-only: resource and service checks; does not install, restart or reconfigure anything.
set -eu
printf 'Read-only V2 preflight at '
date -Iseconds
uname -sr
if [ -f /etc/os-release ]; then
  awk -F= '$1 == "PRETTY_NAME" { print $2 }' /etc/os-release
fi
printf '\nMemory (MiB)\n'
free -m
printf '\nFilesystem containing current directory\n'
df -h .
printf '\nListening TCP ports (no process arguments or credentials)\n'
if command -v ss >/dev/null 2>&1; then ss -ltn; fi
printf '\nDocker availability\n'
if command -v docker >/dev/null 2>&1; then
  docker version --format '{{.Client.Version}} / {{if .Server}}{{.Server.Version}}{{end}}' || true
  docker compose version || true
  docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' || true
else
  printf 'Docker is not installed; no installation attempted.\n'
fi
