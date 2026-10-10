const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildRuntimeConfig,
  validateRuntimeConfig
} = require('../config/runtimeConfig');
const {
  validateAdminPassword,
  validateRefereePassword
} = require('../utils/passwordPolicy');

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '3000',
    DB_HOST: 'localhost',
    DB_USER: 'refweb',
    DB_PASSWORD: 'database-secret',
    DB_NAME: 'referee_system',
    JWT_SECRET: 'this-is-a-long-random-production-secret-123456',
    CORS_ORIGIN: 'https://ref.example.com',
    UPLOAD_DIR: path.resolve('test-data', 'uploads'),
    BACKUP_DIR: path.resolve('test-data', 'backups'),
    ...overrides
  };
}

test('生产配置接受明确 HTTPS 来源和强 JWT 密钥', () => {
  const env = productionEnv();
  const config = buildRuntimeConfig(env);
  assert.doesNotThrow(() => validateRuntimeConfig(config, env));
});

test('生产配置拒绝弱 JWT、通配来源和公网 HTTP', () => {
  for (const overrides of [
    { JWT_SECRET: 'secret123' },
    { CORS_ORIGIN: '*' },
    { CORS_ORIGIN: 'http://ref.example.com' }
  ]) {
    const env = productionEnv(overrides);
    const config = buildRuntimeConfig(env);
    assert.throws(() => validateRuntimeConfig(config, env), /运行配置不安全/);
  }
});

test('生产环境允许不启用 CORS 的同源部署，但拒绝监听公网网卡', () => {
  const sameOriginEnv = productionEnv({ CORS_ORIGIN: '' });
  assert.doesNotThrow(() => validateRuntimeConfig(buildRuntimeConfig(sameOriginEnv), sameOriginEnv));

  const publicBindEnv = productionEnv({ HOST: '0.0.0.0' });
  assert.throws(
    () => validateRuntimeConfig(buildRuntimeConfig(publicBindEnv), publicBindEnv),
    /回环地址/
  );
});

test('生产环境只信任本机反向代理', () => {
  for (const trustProxy of ['true', '1', 'false']) {
    const env = productionEnv({ TRUST_PROXY: trustProxy });
    assert.throws(() => validateRuntimeConfig(buildRuntimeConfig(env), env), /TRUST_PROXY/);
  }
});

test('生产环境要求上传和备份目录使用绝对路径', () => {
  for (const overrides of [
    { UPLOAD_DIR: './uploads' },
    { BACKUP_DIR: './backups' }
  ]) {
    const env = productionEnv(overrides);
    assert.throws(() => validateRuntimeConfig(buildRuntimeConfig(env), env), /绝对路径/);
  }
});

test('本地开发允许 localhost HTTP，但仍要求必要配置', () => {
  const env = {
    NODE_ENV: 'development',
    DB_HOST: 'localhost',
    DB_USER: 'root',
    DB_PASSWORD: 'local',
    DB_NAME: 'referee_system',
    JWT_SECRET: 'local-secret'
  };
  const config = buildRuntimeConfig(env);
  assert.doesNotThrow(() => validateRuntimeConfig(config, env));
});

test('管理员密码执行12位和复杂度要求', () => {
  assert.throws(() => validateAdminPassword('12345678', 'manager'), /12位/);
  assert.throws(() => validateAdminPassword('manager-Strong-123', 'manager'), /用户名/);
  assert.doesNotThrow(() => validateAdminPassword('Safe-RefWeb_2026!', 'manager'));
});

test('裁判新密码执行8位和两类字符要求', () => {
  assert.throws(() => validateRefereePassword('abcdefgh'), /至少包含/);
  assert.doesNotThrow(() => validateRefereePassword('referee2026'));
});
