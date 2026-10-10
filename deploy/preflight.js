const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inventory } = require('../backend/utils/backupIntegrity');
const { buildRuntimeConfig, validateRuntimeConfig } = require('../backend/config/runtimeConfig');
const { validate, render } = require('./renderProduction');
const root = path.resolve(__dirname, '..');
async function main(expected) {
  if (!/^[a-f0-9]{40}$/.test(expected || '')) throw new Error('必须指定已审核的完整提交 SHA');
  const git = args => execFileSync('git', ['-c', `safe.directory=${root}`, ...args], { cwd: root, encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== expected || git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('提交不匹配或工作区不干净，拒绝发布');
  if (process.env.NODE_ENV !== 'production') throw new Error('需要 production 配置');
  validateRuntimeConfig(buildRuntimeConfig(), process.env);
  require('../backend/services/appearanceRollout').readRollout(process.env.APPEARANCE_ROLLOUT_FILE);
  if (process.env.DB_USER === 'root' || !['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)) throw new Error('生产数据库必须使用本机专用账号');
  for (const file of ['backend/.env', 'frontend/.env', 'frontend/.env.production', 'player-frontend/.env', 'player-frontend/.env.production']) {
    try { await fs.access(path.join(root, file)); throw new Error('服务器代码目录不应包含本地 .env 文件，使用 /etc/tj-refweb 配置'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const c = validate(JSON.parse(await fs.readFile('/etc/tj-refweb/sites.json', 'utf8')));
  const activeConfig = await fs.readFile('/etc/tj-refweb/tj-refweb-nginx.conf', 'utf8');
  if (activeConfig.replace(/\r\n/g, '\n') !== render(c, 'https').replace(/\r\n/g, '\n')) throw new Error('先按当前站点配置生成并激活HTTPS，不能发布到ACME启动配置');
  if (c.backendPort !== Number(process.env.PORT) || c.backendPort !== 3000 || c.httpPort !== 80 || c.httpsPort !== 443 || c.refereeRoot !== '/var/www/tj-refweb' || c.playerRoot !== '/var/www/tj-player') throw new Error('当前发布脚本要求默认目录和80/443/3000端口');
  if (process.env.UPLOAD_DIR !== '/var/lib/tj-refweb/uploads' || process.env.BACKUP_DIR !== '/var/backups/tj-refweb') throw new Error('运行目录必须与 systemd 的授权目录一致');
  for (const directory of [c.refereeRoot, c.playerRoot, process.env.UPLOAD_DIR, process.env.BACKUP_DIR]) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('发布目录必须是已准备的真实目录，不能通过符号链接指向其它位置');
  }
  if (process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.ADMIN_BOOTSTRAP_USERNAME) throw new Error('发布前移除临时管理员初始化变量');
  const build = JSON.parse(await fs.readFile(path.join(root, '.cache/production-build.json'), 'utf8'));
  if (build.revision !== expected || build.source_clean !== true) throw new Error('构建产物不是目标干净提交；本地未提交构建不可直接上线');
  for (const d of ['frontend', 'player-frontend']) if (JSON.stringify(build.files[d]) !== JSON.stringify(await inventory(path.join(root, d, 'dist')))) throw new Error('静态产物与构建清单不符');
  console.log('提交、配置和双前端构建清单检查通过');
}
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
