#!/usr/bin/env bash
# 只安装目录、模板和 unit；不改 DNS、防火墙，不启动站点，不初始化数据库。
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo '请用 sudo 执行'; exit 1; }
[[ $(realpath "$(dirname "$0")/..") == /opt/tj-refweb ]] || { echo '代码必须位于 /opt/tj-refweb'; exit 1; }
for cmd in node nginx mysql mysqldump systemctl flock; do command -v "$cmd" >/dev/null; done
[[ $(command -v node) == /usr/bin/node ]] || { echo 'systemd 模板要求 /usr/bin/node'; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)'
if ! id refweb >/dev/null 2>&1; then useradd --system --home-dir /var/lib/tj-refweb --shell /usr/sbin/nologin refweb; fi
install -d -m 0755 /var/lib/tj-refweb /var/lib/tj-refweb/acme /var/www/tj-refweb /var/www/tj-player
install -d -m 0700 -o refweb -g refweb /var/lib/tj-refweb/uploads
install -d -m 0700 /etc/tj-refweb /var/backups/tj-refweb /var/lib/tj-refweb/ops /var/log/tj-refweb
for name in backend ops; do
    if [[ ! -e /etc/tj-refweb/$name.env ]]; then install -m 0600 "/opt/tj-refweb/deploy/$name.env.example" "/etc/tj-refweb/$name.env"; fi
done
if [[ ! -e /etc/tj-refweb/sites.json ]]; then install -m 0600 /opt/tj-refweb/deploy/sites.example.json /etc/tj-refweb/sites.json; fi
for unit in /opt/tj-refweb/deploy/systemd/*; do install -m 0644 "$unit" "/etc/systemd/system/$(basename "$unit")"; done
install -m 0644 /opt/tj-refweb/deploy/logrotate.conf /etc/logrotate.d/tj-refweb
systemctl daemon-reload
echo '模板准备完成。填写私有配置、创建独立空库后，按 deploy/README.md 初始化和发布。尚未启动任何站点。'
