const pool = require('../db');
const adminService = require('../services/adminService');
const { assertMigrationsCurrent } = require('../utils/migrationRunner');

async function main() {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!username || !password) {
    throw new Error(
      '请临时设置 ADMIN_BOOTSTRAP_USERNAME 和 ADMIN_BOOTSTRAP_PASSWORD 后再运行；完成后应从环境配置中删除这两个变量'
    );
  }

  const connection = await pool.getConnection();
  try {
    await assertMigrationsCurrent(connection);
  } finally {
    connection.release();
  }

  const admin = await adminService.bootstrap(username, password);
  console.log(`✓ 管理员 ${admin.username} 已完成安全初始化或密码重置`);
  console.log('✓ 所有旧管理员 JWT 已失效；请立即删除 ADMIN_BOOTSTRAP_PASSWORD 环境变量');
}

main()
  .catch(error => {
    console.error(`✗ 管理员初始化失败: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
