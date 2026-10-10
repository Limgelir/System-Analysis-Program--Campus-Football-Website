// 在普通部署账号下构建；不连接数据库、不复制 .env 或上传资料。
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { inventory } = require('../backend/utils/backupIntegrity');
const root = path.resolve(__dirname, '..');
async function main() {
  if (process.getuid?.() === 0) throw new Error('请用普通部署账号构建，勿用 root 安装 npm 依赖');
  if (process.argv.slice(2).some(a => a !== '--install')) throw new Error('只支持可选参数 --install');
  const env = { ...process.env, VITE_API_BASE_URL: '', NODE_ENV: 'production' };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = (dir, args) => {
    const r = spawnSync(npm, args, { cwd: path.join(root, dir), env, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' });
    if (r.error || r.status !== 0) throw new Error(`${dir} 构建/安装失败`);
  };
  for (const directory of ['backend', 'frontend', 'player-frontend']) {
    if (process.argv.includes('--install')) run(directory, ['ci', '--include=dev']);
    if (directory !== 'backend') run(directory, ['run', 'build']);
  }
  const { assets } = require('../backend/scripts/checkDualSite');
  await Promise.all(['frontend', 'player-frontend'].map(d => assets(path.join(root, d, 'dist'))));
  const build = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), source_clean: !execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), built_at: new Date().toISOString(), files: {} };
  for (const directory of ['frontend', 'player-frontend']) build.files[directory] = await inventory(path.join(root, directory, 'dist'));
  await fs.mkdir(path.join(root, '.cache'), { recursive: true });
  await fs.writeFile(path.join(root, '.cache/production-build.json'), JSON.stringify(build, null, 2));
  console.log('双前端生产构建与文件清单完成；未发布到服务器');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
