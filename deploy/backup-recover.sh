#!/usr/bin/env bash
set -euo pipefail
# 即使 Node 被 systemd 超时终止，也仅恢复本次备份主动停止的服务。
if [[ -f /run/tj-refweb-backup/resume ]]; then
    systemctl start tj-refweb.service
    rm -- /run/tj-refweb-backup/resume
fi
if [[ ${SERVICE_RESULT:-success} != success ]]; then
    /usr/bin/node -e 'require("fs").writeFileSync("/var/lib/tj-refweb/ops/backup-status.json",JSON.stringify({status:"failed",time:new Date().toISOString()}),{mode:0o600})'
fi
