const fs = require('node:fs/promises');
const path = require('node:path');
const { verifyBackup } = require('../utils/backupIntegrity');

async function listBackups(root) {
  const result = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^refweb-\d{4}-\d{2}-\d{2}T[\dTZ-]+-[a-f0-9]{8}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
      const created = Date.parse(manifest.created_at);
      if (manifest.format === 2 && Number.isFinite(created)) result.push({ directory, created, manifest });
    } catch { /* 不碰未知/损坏备份，也不将其视为成功备份。 */ }
  }
  return result.sort((a, b) => b.created - a.created);
}
async function prune(root, days, now = Date.now()) {
  if (!path.isAbsolute(root) || root === path.parse(root).root || !Number.isInteger(days) || days < 2) throw new Error('需要独立绝对备份目录，保留天数至少2天');
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('备份根目录不能为链接');
  const backups = await listBackups(root);
  // 即使过期也至少留下两份经过完整校验的备份；没有两份时不清理。
  const valid = [];
  for (const backup of backups) {
    try { await verifyBackup(backup.directory); valid.push(backup); } catch {}
  }
  const removed = [];
  for (const backup of valid.slice(2)) {
    if (backup.created >= now - days * 86400000) continue;
    await fs.rm(backup.directory, { recursive: true });
    removed.push(path.basename(backup.directory));
  }
  return removed;
}
async function main() {
  const [command, directory] = process.argv.slice(2);
  if (command === 'verify' && directory) {
    await verifyBackup(path.resolve(directory));
    console.log('备份文件和 SHA-256 校验通过');
  } else if (command === 'prune' && !directory && process.env.BACKUP_PRUNE_CONFIRM === 'PRUNE_MANAGED_BACKUPS') {
    const removed = await prune(process.env.BACKUP_DIR, Number(process.env.BACKUP_RETENTION_DAYS || 7));
    console.log(`清理完成：删除 ${removed.length} 份到期备份，至少保留两份有效备份`);
  } else throw new Error('用法: verify 备份目录；或配置 BACKUP_PRUNE_CONFIRM 后运行 prune');
}
if (require.main === module) { require('dotenv').config(); main().catch(error => { console.error(error.message); process.exitCode = 1; }); }
module.exports = { listBackups, prune };
