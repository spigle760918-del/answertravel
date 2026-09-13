#!/usr/bin/env bash
# Launches a copied test workspace in a transient, restricted systemd unit.
# Does not install services or change existing site/database/firewall settings.
set -euo pipefail
[[ $(id -u) == 0 ]] || { printf 'Use the Baota terminal administrator to launch the isolated unit.\n'; exit 1; }
[[ $# == 1 ]] || { printf 'Expected the path to the reviewed V2 verification archive.\n'; exit 1; }
archive=$(realpath -- "$1")
[[ -f "$archive" && ! -L "$archive" ]] || exit 1
for tool in systemd-run systemctl runuser tar sha256sum gcc make curl; do command -v "$tool" >/dev/null; done
id www >/dev/null
available_kib=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
free_kib=$(df -Pk /var/tmp | awk 'NR==2 {print $4}')
[[ $available_kib -ge 2097152 && $free_kib -ge 4194304 ]] || {
  printf 'Need 2 GiB available memory and 4 GiB disk; no test started.\n'; exit 1;
}
work=$(mktemp -d /var/tmp/answertravel-v2-verify-XXXXXXXX)
work=$(realpath -- "$work")
[[ "$work" =~ ^/var/tmp/answertravel-v2-verify-[A-Za-z0-9]+$ && ! -L "$work" ]] || exit 1
# Only the source/test directories in the review archive are extracted.
tar -tzf "$archive" | awk '
  /^\// || /(^|\/)\.\.(\/|$)/ {exit 1}
  !/^v2\// {exit 1}
' || { printf 'Unsafe archive paths; stopped.\n'; exit 1; }
tar -xzf "$archive" -C "$work" --no-same-owner --no-same-permissions
[[ -f "$work/v2/scripts/setup-native-linux.sh" ]] || exit 1
chown -R www:www -- "$work"
unit="answertravel-v2-verify-$(basename "$work" | sed 's/answertravel-v2-verify-//')"
printf 'Verification directory: %s\nTemporary unit: %s\n' "$work" "$unit"
set +e
systemd-run --unit="$unit" --wait --collect \
  --property=User=www --property=Group=www \
  --property="WorkingDirectory=$work/v2" \
  --property=MemoryMax=1536M --property=CPUQuota=50% \
  --property=RuntimeMaxSec=1200 --property=TasksMax=128 \
  --property=Nice=10 --property=NoNewPrivileges=yes \
  --property=ProtectSystem=strict --property=ProtectHome=yes \
  --property="ReadWritePaths=$work" --property=InaccessiblePaths=/www \
  --property=UMask=0077 --property=KillMode=control-group \
  /usr/bin/bash "$work/v2/scripts/setup-native-linux.sh"
result=$?
set -e
journalctl --unit="$unit" --no-pager --output=cat --lines=120 || true
if [[ -f "$work/v2/.runtime/latest-verification.json" ]]; then
  cat "$work/v2/.runtime/latest-verification.json"
fi
printf '\nRetained only test workspace/logs at %s; unit processes stop when the test exits.\n' "$work"
exit "$result"
