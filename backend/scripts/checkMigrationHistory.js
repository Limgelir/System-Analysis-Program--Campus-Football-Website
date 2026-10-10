const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const normalize = value => value.toString('utf8').replace(/\r\n/g, '\n');

function assertUnchanged(name, before, after) {
  if (after === null || normalize(before) !== normalize(after)) {
    throw new Error(`已发布迁移不可修改或删除：${name}；请新增后续版本`);
  }
}
function main(base = process.env.MIGRATION_BASE_REF || 'HEAD') {
  if (!/^(HEAD|[a-f0-9]{40,64})$/.test(base)) throw new Error('迁移比较基准必须是提交 SHA 或 HEAD');
  if (/^0+$/.test(base)) base = 'HEAD'; // 首次推送仍验证 checkout 中已有文件。
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true });
  const names = git(['ls-tree', '-r', '--name-only', base, '--', 'db/migrations/']).toString('utf8').trim().split('\n')
    .filter(name => /^db\/migrations\/\d{4}_[A-Za-z0-9_]+\.js$/.test(name));
  for (const name of names) {
    const file = path.join(root, name);
    assertUnchanged(name, git(['show', `${base}:${name}`]), fs.existsSync(file) ? fs.readFileSync(file) : null);
  }
  console.log(`✓ ${names.length} 个既有迁移内容未修改；后续版本由迁移和集成测试验证`);
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assertUnchanged };
