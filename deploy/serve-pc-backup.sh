#!/usr/bin/env bash
# authorized_keys: restrict,command="/bin/bash /opt/tj-refweb/deploy/serve-pc-backup.sh" ssh-ed25519 ...
set -euo pipefail
[[ ${EUID} -eq 0 ]] || exit 1
# Serialize export/ack with prune/release, and bound disconnected or stalled clients.
exec /usr/bin/timeout 6h /usr/bin/flock -w 60 /run/lock/tj-refweb-maintenance.lock /usr/bin/node --env-file=/etc/tj-refweb/backend.env --env-file=/etc/tj-refweb/ops.env /opt/tj-refweb/deploy/servePcBackup.js
