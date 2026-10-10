// 为同一台服务器的两个 HTTP 端口生成独立站点，共用回环 API。
const fs=require('node:fs'),path=require('node:path');
function quote(value){if(!path.isAbsolute(value)||/[";\r\n]/.test(value))throw Error('静态目录必须为不含控制字符的绝对路径');return '"'+value.replace(/\\/g,'/')+'"';}
function render({refereeRoot='/var/www/tj-refweb',playerRoot='/var/www/tj-player',refereePort=80,playerPort=8080,backendPort=3000,loopback=false}={}){
  for(const value of [refereePort,playerPort,backendPort])if(!Number.isInteger(value)||value<1||value>65535)throw Error('端口必须在1—65535之间');
  if(new Set([refereePort,playerPort,backendPort]).size!==3)throw Error('两个网站与后端端口不能重复');
  return [[refereeRoot,refereePort],[playerRoot,playerPort]].map(([root,port])=>`server {
    listen ${loopback?'127.0.0.1:':''}${port} default_server;
    server_name _;
    root ${quote(root)};
    index index.html;
    server_tokens off;
    client_max_body_size 11m;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'" always;
    location = /api { return 404; }
    location /api/ {
        proxy_pass http://127.0.0.1:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
    location = /health {
        proxy_pass http://127.0.0.1:${backendPort}/health;
        access_log off;
    }
    location ~ (^|/)\\. { return 404; }
    location ~* \\.(seed|sql|env|bak|log)$ { return 404; }
    location /uploads/ { return 404; }
    location /assets/ { try_files $uri =404; expires 7d; }
    location / { try_files $uri $uri/ /index.html; expires -1; }
}
`).join('\n');
}
if(require.main===module){try{const args=process.argv.slice(2);if(args.length>1||args.length&&!/^--output=.+$/.test(args[0]))throw Error('可选参数 --output=新文件；原站80、球员8080、后端3000');const config=render();if(args.length)fs.writeFileSync(args[0].slice(9),config,{flag:'wx'});else process.stdout.write(config);}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={render};
