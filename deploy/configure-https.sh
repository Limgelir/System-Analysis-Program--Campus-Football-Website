#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 && $# -eq 1 && "$1" =~ ^(bootstrap|certificate|activate|renew-test)$ ]] || { echo '用法: sudo bash deploy/configure-https.sh bootstrap|certificate|activate|renew-test'; exit 1; }
cd /opt/tj-refweb
config=/etc/tj-refweb/tj-refweb-nginx.conf
if [[ -e /etc/nginx/sites-enabled/tj-refweb || -L /etc/nginx/sites-enabled/tj-refweb ]]; then
    [[ $(readlink -f /etc/nginx/sites-enabled/tj-refweb) == "$config" ]] || { echo '已有同名 Nginx 站点，拒绝覆盖'; exit 1; }
fi
readarray -t domains < <(node -e 'const {validate}=require("./deploy/renderProduction");const c=validate(require("/etc/tj-refweb/sites.json"));for(const d of [c.refereeDomain,c.playerDomain,...c.refereeAliases])console.log(d)')
[[ ${#domains[@]} -ge 2 ]] || { echo '无效站点配置'; exit 1; }
case "$1" in
bootstrap|activate)
    mode=bootstrap
    if [[ $1 == activate ]]; then mode=https; fi
    temp=$(mktemp /etc/tj-refweb/nginx.XXXXXX)
    previous=$(mktemp /etc/tj-refweb/nginx.previous.XXXXXX)
    existed=false
    if [[ -f $config ]]; then cp -- "$config" "$previous"; existed=true; fi
    trap 'rm -f -- "$temp" "$previous"' EXIT
    node deploy/renderProduction.js --config=/etc/tj-refweb/sites.json --mode="$mode" >"$temp"
    install -m 0600 "$temp" "$config"
    if [[ ! -e /etc/nginx/sites-enabled/tj-refweb ]]; then ln -s "$config" /etc/nginx/sites-enabled/tj-refweb; fi
    if ! nginx -t; then
        if [[ $existed == true ]]; then cp -- "$previous" "$config"; else rm -f -- /etc/nginx/sites-enabled/tj-refweb "$config"; fi
        echo 'Nginx 配置无效，已恢复原配置。检查是否存在另一份 default_server'; exit 1
    fi
    systemctl reload nginx
    ;;
certificate)
    [[ -n ${CERTBOT_EMAIL:-} ]] || { echo '请通过 CERTBOT_EMAIL 指定证书通知邮箱'; exit 1; }
    args=()
    for domain in "${domains[@]}"; do args+=(-d "$domain"); done
    certbot certonly --webroot -w /var/lib/tj-refweb/acme --cert-name tj-refweb "${args[@]}" --email "$CERTBOT_EMAIL" --agree-tos --non-interactive
    install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
    install -m 0755 deploy/certbot-reload.sh /etc/letsencrypt/renewal-hooks/deploy/tj-refweb
    systemctl enable --now certbot.timer
    ;;
renew-test)
    certbot renew --cert-name tj-refweb --dry-run --run-deploy-hooks
    ;;
esac
