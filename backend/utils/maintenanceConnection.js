const path = require('node:path');
// Ubuntu uses root's local Unix socket authentication for one-off schema operations.
// Runtime remains the database-scoped application account; no global MySQL setting is relaxed.
function maintenanceConnection(env, operation, platform = process.platform, uid = process.getuid?.()) {
  const socket = env[`${operation}_DB_SOCKET`];
  if (!socket) return { host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD };
  if (!['INIT', 'RESTORE'].includes(operation) || platform !== 'linux' || uid !== 0 || !path.posix.isAbsolute(socket) || !/^\/[a-zA-Z0-9_./-]+$/.test(socket)) throw new Error('维护socket仅允许Linux本机root显式使用');
  return { socketPath: socket, user: 'root' };
}
module.exports = { maintenanceConnection };
