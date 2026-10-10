const path = require('node:path');
const { readRollout } = require('../services/appearanceRollout');
try {
  const file = process.argv[2];
  if (!file) throw new Error('用法: node backend/scripts/checkAppearanceRollout.js 配置文件路径');
  const config = readRollout(path.resolve(file));
  console.log(`外观配置有效：总开关${config.enabled ? '开启' : '关闭'}，${config.accounts.length} 个体验账号。`);
  if (config.enabled && !config.accounts.length) console.log('名单为空，所有账号仍使用旧版。');
} catch (error) {
  console.error(`外观配置无效：${error.message}`);
  process.exitCode = 1;
}
