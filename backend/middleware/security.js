const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

function rateLimitHandler(message) {
  return (req, res) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfterSeconds = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : undefined;
    res.status(429).json({
      success: false,
      message,
      retry_after_seconds: retryAfterSeconds
    });
  };
}

function createSecurityMiddleware(config) {
  const securityHeaders = helmet({
    // API 本身不提供网页；前端的 CSP 由反向代理配置。
    contentSecurityPolicy: false,
    strictTransportSecurity: config.isProduction ? undefined : false
  });

  const commonOptions = {
    standardHeaders: 'draft-8',
    legacyHeaders: false
  };

  const apiLimiter = rateLimit({
    ...commonOptions,
    windowMs: config.apiRateLimitWindowMs,
    limit: config.apiRateLimitMax,
    handler: rateLimitHandler('请求过于频繁，请稍后再试')
  });

  const makeLoginLimiter = () => rateLimit({
    ...commonOptions,
    windowMs: config.loginRateLimitWindowMs,
    limit: config.loginRateLimitMax,
    skipSuccessfulRequests: true,
    handler: rateLimitHandler('登录失败次数过多，请稍后再试')
  });

  const makeRegistrationLimiter = () => rateLimit({
    ...commonOptions,
    windowMs: config.registrationRateLimitWindowMs,
    limit: config.registrationRateLimitMax,
    handler: rateLimitHandler('注册请求过于频繁，请稍后再试')
  });

  return { securityHeaders, apiLimiter, loginLimiter: makeLoginLimiter(), registrationLimiter: makeRegistrationLimiter(),
    playerLoginLimiter: makeLoginLimiter(), playerRegistrationLimiter: makeRegistrationLimiter() };
}

module.exports = {
  rateLimitHandler,
  createSecurityMiddleware
};
