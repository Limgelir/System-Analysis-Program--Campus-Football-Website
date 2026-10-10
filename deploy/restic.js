// 通过 Node 的 --env-file 加载私有配置，避免用 shell source 解析 dotenv。
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const [command, snapshot, destination] = process.argv.slice(2);
let args;
try {
  if (!process.env.RESTIC_REPOSITORY || !process.env.RESTIC_PASSWORD_FILE) throw new Error('先配置异机仓库和密码文件');
  if (['init', 'snapshots', 'check'].includes(command) && !snapshot && !destination) args = [command];
  else if (command === 'restore' && /^[a-f0-9]{8,64}$/.test(snapshot || '') && destination && path.isAbsolute(destination) && !fs.existsSync(destination)) args = ['restore', snapshot, '--target', destination];
  else throw new Error('用法: init | snapshots | check | restore 快照ID 不存在的绝对目录');
  const child = spawn('restic', args, { shell: false, windowsHide: true, stdio: 'inherit', env: process.env });
  child.once('error', () => { console.error('restic 无法启动'); process.exitCode = 1; });
  child.once('close', code => process.exitCode = code ?? 1);
} catch (error) { console.error(error.message); process.exitCode = 1; }
