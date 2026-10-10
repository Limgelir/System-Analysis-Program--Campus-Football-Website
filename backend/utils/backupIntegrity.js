const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');

function overlaps(a, b) {
  a = path.resolve(a); b = path.resolve(b);
  const within = (parent, child) => { const r = path.relative(parent, child); return !r || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
  return within(a, b) || within(b, a);
}
async function inventory(root) {
  const result = [];
  async function walk(directory) {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('备份目录不能为符号链接');
    for (const name of (await fs.readdir(directory)).sort()) {
      const file = path.join(directory, name), relative = path.relative(root, file).split(path.sep).join('/');
      if (relative === 'manifest.json') continue;
      const info = await fs.lstat(file);
      if (info.isSymbolicLink()) throw new Error('备份不允许符号链接');
      if (info.isDirectory()) await walk(file);
      else if (info.isFile()) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        result.push({ path: relative, bytes: info.size, sha256: hash.digest('hex') });
      } else throw new Error('备份只允许普通文件和目录');
    }
  }
  await walk(path.resolve(root));
  // 固定字符顺序，避免 Windows/Linux 或不同 ICU 版本导致清单顺序变化。
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
async function verifyBackup(root) {
  const manifestPath = path.join(root, 'manifest.json');
  if (!(await fs.lstat(manifestPath)).isFile() || (await fs.lstat(manifestPath)).isSymbolicLink()) throw new Error('无效清单文件');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.format !== 2 || !Array.isArray(manifest.files) || !Number.isFinite(Date.parse(manifest.created_at))) throw new Error('仅支持包含校验清单的 v2 备份');
  const actual = await inventory(root);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('备份校验失败：文件缺失、增加或内容损坏');
  if (!actual.some(f => f.path === 'database.sql' && f.bytes > 0)) throw new Error('数据库备份缺失');
  if (!(await fs.lstat(path.join(root, 'uploads'))).isDirectory()) throw new Error('上传目录缺失');
  return manifest;
}
module.exports = { overlaps, inventory, verifyBackup };
