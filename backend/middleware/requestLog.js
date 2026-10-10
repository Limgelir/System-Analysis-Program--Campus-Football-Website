const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const requestContext = new AsyncLocalStorage();

// 严格白名单：不收集 URL、查询、正文、文件名、IP、JWT 或账号姓名/学号。
function requestLog(req, res, next) {
  const forwarded = req.headers['x-request-id'];
  const trusted = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const requestId = trusted && typeof forwarded === 'string' && /^[a-f0-9]{32}$/.test(forwarded) ? forwarded : randomUUID();
  res.setHeader('X-Request-ID', requestId);
  const start = performance.now();
  requestContext.run({ requestId }, () => {
    let logged = false;
    const record = () => {
      if (logged) return;
      logged = true;
      if (req.path === '/health' || req.path === '/health/live') return;
      const template = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      const actor = req.authenticatedActor;
      const event = {
        time: new Date().toISOString(), channel: 'request', event: 'http_request', request_id: requestId,
        method: req.method, route: template === 'unmatched' ? template : `${req.baseUrl || ''}${template}`,
        status: res.writableFinished ? res.statusCode : 499,
        duration_ms: Math.round(performance.now() - start)
      };
      console.log(JSON.stringify(event));
      // 业务详细变更仍由各业务事务内的历史表保存；此处记录操作结果及已验证操作者。
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const targetIds = Object.fromEntries(Object.entries(req.params || {}).filter(([key, value]) => /id$/i.test(key) && /^[1-9]\d{0,14}$/.test(String(value))));
        console.log(JSON.stringify({ ...event, channel: 'operation', event: 'http_mutation',
          actor_role: actor?.role || 'anonymous', actor_id: actor?.id || null, target_ids: targetIds }));
      }
    };
    res.once('finish', record);
    res.once('close', record);
    next();
  });
}
module.exports = { requestLog, requestContext };
