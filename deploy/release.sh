#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 && $# -eq 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || { echo '用法: sudo bash deploy/release.sh 完整SHA'; exit 1; }
cd /opt/tj-refweb
exec 9>/run/lock/tj-refweb-maintenance.lock
flock -n 9 || { echo '已有备份或发布任务正在运行'; exit 1; }
node --env-file=/etc/tj-refweb/backend.env deploy/preflight.js "$1"
[[ -f /etc/tj-refweb/tj-refweb-nginx.conf ]] || { echo '请先完成证书和 HTTPS 配置'; exit 1; }
nginx -t
systemctl stop tj-refweb
# 首次发布同样备份已经初始化的数据库；停服状态不能成为跳过备份的理由。
# 失败保持停服，不能自动启动可能与迁移后数据库不兼容的代码。
BACKUP_CONSISTENCY=service-stopped BACKUP_INCLUDE_DEPLOYMENT=true node --env-file=/etc/tj-refweb/backend.env backend/scripts/backup.js
node --env-file=/etc/tj-refweb/backend.env backend/scripts/migrate.js up
node --env-file=/etc/tj-refweb/backend.env backend/scripts/migrate.js check
node --env-file=/etc/tj-refweb/backend.env backend/scripts/audit.js
rsync -a --delete --chmod=D755,F644 frontend/dist/ /var/www/tj-refweb/
rsync -a --delete --chmod=D755,F644 player-frontend/dist/ /var/www/tj-player/
systemctl enable --now tj-refweb
for attempt in {1..20}; do
    if curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:3000/health >/dev/null; then break; fi
    if [[ $attempt == 20 ]]; then echo '后端未就绪，保留现场排查，不自动回退数据库'; exit 1; fi
    sleep 1
done
node --env-file=/etc/tj-refweb/backend.env --env-file=/etc/tj-refweb/ops.env deploy/smoke.js
node -e 'require("fs").writeFileSync("/etc/tj-refweb/release.json",JSON.stringify({revision:process.argv[1],released_at:new Date().toISOString()}),{mode:0o600})' "$1"
echo '发布与网络冒烟完成；仍需真人业务验收，备份与告警演练。'
