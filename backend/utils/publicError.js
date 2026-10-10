const INTERNAL_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EACCES',
  'EPERM'
]);

function isInternalError(error, statusCode) {
  const code = String(error?.code || '');
  return Number(statusCode) >= 500 || code.startsWith('ER_') || INTERNAL_ERROR_CODES.has(code);
}

function publicErrorMessage(error, fallbackMessage, statusCode = 500) {
  if (process.env.NODE_ENV === 'production' && isInternalError(error, statusCode)) {
    return fallbackMessage;
  }
  return error?.message || fallbackMessage;
}

module.exports = {
  INTERNAL_ERROR_CODES,
  isInternalError,
  publicErrorMessage
};
