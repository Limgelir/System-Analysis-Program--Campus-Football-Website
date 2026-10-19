const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { runPendingMigrations } = require('../utils/migrationRunner');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');
const TEST_ENV_PATH = path.join(BACKEND_ROOT, '.env.test');
const LOCAL_ENV_PATH = path.join(BACKEND_ROOT, '.env');

function loadTestConnectionEnvironment() {
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境禁止运行隔离测试工具');
  const envPath = fs.existsSync(TEST_ENV_PATH) ? TEST_ENV_PATH : LOCAL_ENV_PATH;
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境禁止运行隔离测试工具');

  const developmentDatabase = String(process.env.DB_NAME || 'referee_system').trim();
  const testDatabase = String(process.env.TEST_DB_NAME || `${developmentDatabase}_test`).trim();

  if (!/^[A-Za-z0-9_]+$/.test(testDatabase) || !testDatabase.toLowerCase().endsWith('_test')) {
    throw new Error('TEST_DB_NAME 必须只包含字母、数字、下划线，并以 _test 结尾');
  }
  if (testDatabase === developmentDatabase) {
    throw new Error('测试数据库不能与开发数据库同名');
  }

  for (const field of ['DB_HOST', 'DB_USER', 'DB_PASSWORD']) {
    if (!String(process.env[field] || '').trim()) {
      throw new Error(`${field} 未配置；请设置 backend/.env.test 或 backend/.env`);
    }
  }
  if (!['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST)) throw new Error('测试工具仅允许连接本机 MySQL，不允许远程数据库');

  return {
    testDatabase,
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      charset: 'utf8mb4'
    }
  };
}

async function executeSqlScript(connection, source) {
  let delimiter = ';';
  let buffer = '';
  const statements = [];

  for (const line of source.split(/\r?\n/)) {
    const delimiterMatch = /^\s*DELIMITER\s+(.+)\s*$/i.exec(line);
    if (delimiterMatch) {
      delimiter = delimiterMatch[1];
      continue;
    }

    buffer += `${line}\n`;
    if (buffer.trimEnd().endsWith(delimiter)) {
      const trimmed = buffer.trimEnd();
      const statement = trimmed.slice(0, trimmed.length - delimiter.length).trim();
      if (statement) statements.push(statement);
      buffer = '';
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());
  for (const statement of statements) {
    await connection.query(statement);
  }
}

function runNodeTests(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--test', process.argv.includes('--assignment-changes')?'tests/integration/assignmentChanges.test.js':process.argv.includes('--assignment-export')?'tests/integration/assignmentExport.test.js':process.argv.includes('--fourth-sheet')?'tests/integration/fourthOfficialSheet.test.js':process.argv.includes('--schedule-imports')?'tests/integration/scheduleImports.test.js':process.argv.includes('--futsal')?'tests/integration/futsal.test.js':process.argv.includes('--team-auto-review')?'tests/integration/teamAutoReview.test.js':process.argv.includes('--schedule-deletion')?'tests/integration/scheduleDeletion.test.js':process.argv.includes('--supervision')?'tests/integration/supervision.test.js':process.argv.includes('--imports')?'tests/integration/adminImports.test.js':process.argv.includes('--competitions')?'tests/integration/competitions.test.js':'tests/integration/api.test.js'],
      { cwd: BACKEND_ROOT, env, stdio: 'inherit' }
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`API 集成测试被信号 ${signal} 中止`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const { testDatabase: testPrefix, connection: connectionOptions } = loadTestConnectionEnvironment();
  const testDatabase=`${testPrefix.slice(0,38)}_${require('crypto').randomBytes(6).toString('hex')}_test`;
  const adminConnection = await mysql.createConnection(connectionOptions);
  const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-refweb-api-test-'));
  let exitCode = 1;
  let ownsDatabase = false;

  try {
    await adminConnection.query(`CREATE DATABASE \`${testDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    ownsDatabase = true;

    const schemaPath = path.join(PROJECT_ROOT, 'db', 'final_schema.sql');
    const schemaSource = fs.readFileSync(schemaPath, 'utf8')
      .replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i, `CREATE DATABASE IF NOT EXISTS \`${testDatabase}\``)
      .replace(/USE\s+referee_system\s*;/i, `USE \`${testDatabase}\`;`);
    await executeSqlScript(adminConnection, schemaSource);

    const migrationConnection = await mysql.createConnection({
      ...connectionOptions,
      database: testDatabase,
      dateStrings: ['DATE']
    });
    try {
      await runPendingMigrations(migrationConnection);
    } finally {
      await migrationConnection.end();
    }

    const testEnv = {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3000',
      DB_NAME: testDatabase,
      JWT_SECRET: process.env.JWT_SECRET || 'test_only_jwt_secret_with_at_least_32_characters',
      JWT_EXPIRES_IN: '1h',
      CORS_ORIGIN: '',
      TRUST_PROXY: 'false',
      UPLOAD_DIR: uploadRoot,
      REFWEB_INTEGRATION_TEST: '1',
      API_RATE_LIMIT_MAX: '5000',
      REGISTRATION_RATE_LIMIT_MAX: '200',
      LOGIN_RATE_LIMIT_MAX: '200' // 隔离回归集中发出负面请求；不改变生产 IP 限流与持久化账号锁阈值。
    };

    console.log(`\n✓ API 集成测试数据库已重建并迁移: ${testDatabase}`);
    console.log(`✓ API 集成测试上传目录: ${uploadRoot}\n`);
    exitCode = await runNodeTests(testEnv);
  } finally {
    try {
      if (ownsDatabase) await adminConnection.query(`DROP DATABASE \`${testDatabase}\``);
      console.log(`\n✓ API 集成测试数据库已清理: ${testDatabase}`);
    } finally {
      await adminConnection.end();
      fs.rmSync(uploadRoot, { recursive: true, force: true });
    }
  }

  process.exitCode = exitCode;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`✗ API 集成测试基础设施失败: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  executeSqlScript,
  loadTestConnectionEnvironment
};
