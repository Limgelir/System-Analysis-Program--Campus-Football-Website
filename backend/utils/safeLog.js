// Never serialize an Error: mysql errors can contain SQL values (including password hashes).
function safeLog(context, error, level = 'error') {
  const status = Number(error?.statusCode || error?.status);
  if (error?.isBusinessError || (status >= 400 && status < 500)) return;
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code : 'INTERNAL_ERROR';
  const requestId = require('../middleware/requestLog').requestContext.getStore()?.requestId;
  console[level === 'warn' ? 'warn' : 'error'](JSON.stringify({
    time: new Date().toISOString(), channel: 'error', event: context, code,
    ...(requestId ? { request_id: requestId } : {})
  }));
}
module.exports = { safeLog };
