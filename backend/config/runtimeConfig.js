const path = require('path');

const INSECURE_SECRET_MARKERS = [
  'replace_with',
  'change_me',
  'your_secret',
  'secret123',
  'development_secret'
];

function parsePositiveInteger(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} 必须是正整数`);
  }
  return parsed;
}

function parseCorsOrigins(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function parseTrustProxy(value, isProduction) {
  if (value === undefined || value === null || value === '') {
    return isProduction ? 'loopback' : false;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function isLocalHttpOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function buildRuntimeConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const corsOrigins = parseCorsOrigins(
    env.CORS_ORIGIN || (isProduction ? '' : 'http://localhost:5174,http://127.0.0.1:5174')
  );

  return {
    isProduction,
    host: String(env.HOST || '127.0.0.1').trim(),
    port: parsePositiveInteger(env.PORT, 3000, 'PORT'),
    corsOrigins,
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction),
    jsonBodyLimit: env.JSON_BODY_LIMIT || '1mb',
    apiRateLimitWindowMs: parsePositiveInteger(env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, 'API_RATE_LIMIT_WINDOW_MS'),
    apiRateLimitMax: parsePositiveInteger(env.API_RATE_LIMIT_MAX, 600, 'API_RATE_LIMIT_MAX'),
    loginRateLimitWindowMs: parsePositiveInteger(env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, 'LOGIN_RATE_LIMIT_WINDOW_MS'),
    loginRateLimitMax: parsePositiveInteger(env.LOGIN_RATE_LIMIT_MAX, 10, 'LOGIN_RATE_LIMIT_MAX'),
    registrationRateLimitWindowMs: parsePositiveInteger(env.REGISTRATION_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000, 'REGISTRATION_RATE_LIMIT_WINDOW_MS'),
    registrationRateLimitMax: parsePositiveInteger(env.REGISTRATION_RATE_LIMIT_MAX, 5, 'REGISTRATION_RATE_LIMIT_MAX')
  };
}

function validateRuntimeConfig(config, env = process.env) {
  const errors = [];
  const jwtSecret = String(env.JWT_SECRET || '');

  if (!jwtSecret) {
    errors.push('JWT_SECRET 未配置');
  } else if (config.isProduction) {
    const normalized = jwtSecret.toLowerCase();
    if (jwtSecret.length < 32) {
      errors.push('生产环境 JWT_SECRET 长度必须至少为32位');
    }
    if (INSECURE_SECRET_MARKERS.some(marker => normalized.includes(marker))) {
      errors.push('生产环境 JWT_SECRET 仍是示例或弱密钥');
    }
  }

  for (const fieldName of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    const value = String(env[fieldName] || '');
    if (!value || (config.isProduction && value.toLowerCase().includes('replace_with'))) {
      errors.push(`${fieldName} 未正确配置`);
    }
  }

  if (!config.host) {
    errors.push('HOST 未配置');
  }
  if (config.isProduction && !['127.0.0.1', '::1', 'localhost'].includes(config.host)) {
    errors.push('生产环境 HOST 必须绑定到回环地址，由 Nginx 反向代理访问');
  }
  if (config.isProduction && config.trustProxy !== 'loopback') {
    errors.push('生产环境 TRUST_PROXY 必须为 loopback，避免伪造客户端 IP 绕过限流');
  }

  // 生产环境前后端同源部署时不需要 CORS；留空即完全不返回跨域许可。
  for (const origin of config.corsOrigins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      errors.push(`CORS_ORIGIN 包含无效地址: ${origin}`);
      continue;
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || origin.includes('*')) {
      errors.push(`CORS_ORIGIN 只允许明确的 HTTP(S) 来源: ${origin}`);
    }
    if (config.isProduction && parsed.protocol !== 'https:' && !isLocalHttpOrigin(origin)) {
      errors.push(`生产环境公网来源必须使用 HTTPS: ${origin}`);
    }
  }

  if (config.isProduction && env.UPLOAD_DIR && !path.isAbsolute(env.UPLOAD_DIR)) {
    errors.push('生产环境显式配置 UPLOAD_DIR 时必须使用绝对路径');
  }
  if (config.isProduction && env.BACKUP_DIR && !path.isAbsolute(env.BACKUP_DIR)) {
    errors.push('生产环境显式配置 BACKUP_DIR 时必须使用绝对路径');
  }

  if (errors.length > 0) {
    throw new Error(`运行配置不安全：${errors.join('；')}`);
  }
  return config;
}

module.exports = {
  INSECURE_SECRET_MARKERS,
  parsePositiveInteger,
  parseCorsOrigins,
  parseTrustProxy,
  buildRuntimeConfig,
  validateRuntimeConfig
};
