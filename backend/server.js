const { safeLog } = require('./utils/safeLog');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const pool = require('./db');
const { buildRuntimeConfig, validateRuntimeConfig } = require('./config/runtimeConfig');
const { createSecurityMiddleware } = require('./middleware/security');
const { assertMigrationsCurrent } = require('./utils/migrationRunner');
const { assertSecureProductionAdmins } = require('./utils/adminSecurity');
const { UPLOAD_ROOT, ensureUploadDirectories } = require('./utils/uploadPaths');

const runtimeConfig = buildRuntimeConfig(process.env);
const app = express();
app.set('trust proxy', runtimeConfig.trustProxy);

const {
  securityHeaders,
  apiLimiter,
  loginLimiter,
  registrationLimiter,
  playerLoginLimiter,
  playerRegistrationLimiter
} = createSecurityMiddleware(runtimeConfig);

app.disable('x-powered-by');
app.use(require('./middleware/requestLog').requestLog);
app.use(securityHeaders);
if (runtimeConfig.corsOrigins.length > 0) {
  app.use(cors({ origin: runtimeConfig.corsOrigins }));
}
app.use(express.json({ limit: runtimeConfig.jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: runtimeConfig.jsonBodyLimit }));

const refereeRoutes = require('./routes/refereeRoutes');
const adminRoutes = require('./routes/adminRoutes');
const teamRoutes = require('./routes/teamRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const seasonRoutes = require('./routes/seasonRoutes');
const seasonRegistrationRoutes = require('./routes/seasonRegistrationRoutes');
const reportRoutes = require('./routes/reportRoutes');
const fileRoutes = require('./routes/fileRoutes');

// 登录和注册使用更严格的独立限流；成功登录不计入失败次数。
app.use('/api/admin/login', loginLimiter);
app.use('/api/referee/login', loginLimiter);
app.use('/api/referee/register', registrationLimiter);
app.use('/api/player/register', playerRegistrationLimiter);
app.use('/api/player/login', playerLoginLimiter);
app.use('/api/player/me/password', playerLoginLimiter);
app.use('/api/player/me/student-id', playerLoginLimiter);
app.use('/api', apiLimiter);
app.use('/api', (req,res,next) => { res.set('Cache-Control','no-store'); next(); });

app.use('/api/referee', refereeRoutes);
app.use('/api/appearance', require('./routes/appearanceRoutes'));
app.use('/api/public', require('./routes/playerPublicRoutes').publicRouter);
app.use('/api/player', require('./routes/playerPublicRoutes').player);
app.use('/api/player-admin', require('./routes/playerPublicRoutes').admin);
app.use('/api/player', require('./routes/playerTeamRoutes').player);
app.use('/api/player-admin', require('./routes/playerTeamRoutes').admin);
app.use('/api/player', require('./routes/playerWorkflowRoutes').player);
app.use('/api/player-admin', require('./routes/playerWorkflowRoutes').admin);
app.use('/api/player/college-changes', require('./routes/playerCollegeChangeRoutes').player);
app.use('/api/player-admin/college-changes', require('./routes/playerCollegeChangeRoutes').admin);
app.use('/api/player', require('./routes/playerRoutes'));
app.use('/api/player-admin', require('./routes/playerAdminRoutes'));
app.use('/api/admin', adminRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/match-signups', require('./routes/matchSignupRoutes'));
app.use('/api/officials', require('./routes/officialRoutes'));
app.use('/api/season', seasonRoutes);
app.use('/api/competitions', require('./routes/competitionRoutes'));
app.use('/api/season-registration', seasonRegistrationRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/files', fileRoutes);

// 存活检查只确认 Node 进程可以响应；就绪检查同时验证数据库和迁移状态。
app.get('/health/live', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    await assertMigrationsCurrent(connection);
    res.json({
      status: 'ok',
      checks: { database: 'ok', migrations: 'ok' }
    });
  } catch (error) {
    safeLog('就绪检查失败:', error, 'error');
    res.status(503).json({
      status: 'unavailable',
      checks: { database: 'unavailable' }
    });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/', (req, res) => {
  res.json({
    name: '校园足球裁判执裁管理系统',
    version: '1.0.0',
    status: 'running'
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  safeLog('unhandled_request_error', err);
  const status = Number(err?.status || err?.statusCode || 500);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    message: status === 404 ? '文件不存在' : '服务器内部错误',
    error: runtimeConfig.isProduction ? undefined : err.message
  });
});

let httpServer = null;
let shuttingDown = false;

async function startServer() {
  let connection;
  try {
    validateRuntimeConfig(runtimeConfig, process.env);
    ensureUploadDirectories();
    connection = await pool.getConnection();
    await assertMigrationsCurrent(connection);
    if (runtimeConfig.isProduction) {
      await assertSecureProductionAdmins(connection);
    }
    connection.release();
    connection = null;

    await new Promise((resolve, reject) => {
      httpServer = app.listen(runtimeConfig.port, runtimeConfig.host, resolve);
      httpServer.once('error', reject);
    });
    console.log(`\n✓ 服务器已启动，监听 http://${runtimeConfig.host}:${runtimeConfig.port}`);
    console.log(`✓ 环境: ${process.env.NODE_ENV}`);
    console.log(`✓ 数据库: ${process.env.DB_NAME}`);
    console.log(`✓ 上传目录: ${UPLOAD_ROOT}`);
    console.log('✓ 数据库迁移与生产安全检查已通过\n');
  } catch (error) {
    if (connection) connection.release();
    safeLog('✗ 启动失败:', error, 'error');
    await pool.end();
    process.exitCode = 1;
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n收到 ${signal}，正在安全停止服务...`);

  const forceExitTimer = setTimeout(() => {
    console.error('✗ 服务未能在10秒内停止，强制退出');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve));
  }
  await pool.end();
  clearTimeout(forceExitTimer);
  process.exit(0);
}

if (require.main === module) {
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  startServer();
}

// 集成测试直接挂载 Express app，并自行使用随机端口；生产启动仍由上面的 main 分支负责。
module.exports = app;
module.exports.startServer = startServer;
module.exports.shutdown = shutdown;
