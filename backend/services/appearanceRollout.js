const fs = require('node:fs');
const path = require('node:path');

const ROLES = new Set(['admin', 'referee', 'player']);
function validateRollout(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['enabled', 'accounts'].includes(key)) ||
      typeof value.enabled !== 'boolean' || !Array.isArray(value.accounts) || value.accounts.length > 10000) {
    throw new Error('配置必须包含 enabled 布尔值和 accounts 数组（最多 10000 项）');
  }
  const seen = new Set();
  for (const account of value.accounts) {
    if (!account || Object.keys(account).some(key => !['role', 'id'].includes(key)) ||
        !ROLES.has(account.role) || !Number.isSafeInteger(account.id) || account.id <= 0) {
      throw new Error('名单只接受 admin/referee/player 角色和正整数账号 ID');
    }
    const key = `${account.role}:${account.id}`;
    if (seen.has(key)) throw new Error('名单存在重复账号');
    seen.add(key);
  }
  return value;
}

function readRollout(file) {
  if (!file) return { enabled: false, accounts: [] };
  if (!path.isAbsolute(file)) throw new Error('APPEARANCE_ROLLOUT_FILE 必须是绝对路径');
  if (fs.statSync(file).size > 1024 * 1024) throw new Error('外观配置超过 1MB');
  return validateRollout(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
}

function resolveAppearance(actor, config) {
  const account = { role: actor.role, id: actor.id };
  return {
    enabled: config.enabled && config.accounts.some(item => item.role === account.role && item.id === account.id),
    account
  };
}

let lastProblem;
function getAppearance(actor) {
  try {
    // Read on every request: atomic configuration replacement needs no restart.
    const result = resolveAppearance(actor, readRollout(process.env.APPEARANCE_ROLLOUT_FILE));
    lastProblem = undefined;
    return result;
  } catch (error) {
    const problem = error.code || error.name;
    if (problem !== lastProblem) console.warn('外观体验配置不可用，已关闭新版界面。');
    lastProblem = problem;
    return { enabled: false, account: { role: actor.role, id: actor.id } };
  }
}

module.exports = { validateRollout, readRollout, resolveAppearance, getAppearance };
