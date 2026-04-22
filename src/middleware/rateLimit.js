const RateLimiter = require('../utils/rateLimiter');

const globalLimiter = new RateLimiter(60000, 1000); // 每分钟最多1000个请求
const uploadLimiter = new RateLimiter(60000, 20); // 每分钟最多20个上传请求
const emailVerifyLimiter = new RateLimiter(60000, 10); // 每分钟最多10个邮箱验证请求
const loginLimiter = new RateLimiter(60000, 20); // 每分钟最多20次登录尝试（按IP）
const tfaLimiter = new RateLimiter(60000, 20); // 每分钟最多20次2FA校验（按IP）
const passwordResetRequestLimiter = new RateLimiter(60000, 10); // 每分钟最多10次找回密码请求（按IP）
const passwordResetConfirmLimiter = new RateLimiter(60000, 10); // 每分钟最多10次密码重置提交（按IP）
const bindEmailSendLimiter = new RateLimiter(60000, 10); // 每分钟最多10次邮箱验证码发送（按IP）

function normalizeScopePart(value) {
  return String(value || '').trim().toLowerCase().slice(0, 256);
}

function getScopedKey(req, scope) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const normalizedScope = normalizeScopePart(scope);
  return normalizedScope ? `${ip}:${normalizedScope}` : ip;
}

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  if (!globalLimiter.isAllowed(ip)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  next();
}

function uploadRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  if (!uploadLimiter.isAllowed(ip)) {
    return res.status(429).json({ error: '上传过于频繁，请稍后再试' });
  }
  next();
}

function emailVerifyRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  if (!emailVerifyLimiter.isAllowed(ip)) {
    return res.status(429).json({ error: '验证请求过于频繁，请稍后再试' });
  }
  next();
}

function loginRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const identifierKey = getScopedKey(req, req.body?.user);

  if (!loginLimiter.isAllowed(ip) || !loginLimiter.isAllowed(identifierKey)) {
    return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试' });
  }

  next();
}

function tfaRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const tokenKey = getScopedKey(req, req.body?.tempToken);

  if (!tfaLimiter.isAllowed(ip) || !tfaLimiter.isAllowed(tokenKey)) {
    return res.status(429).json({ error: '验证尝试过于频繁，请稍后再试' });
  }

  next();
}

function passwordResetRequestRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const emailKey = getScopedKey(req, req.body?.email);

  if (!passwordResetRequestLimiter.isAllowed(ip) || !passwordResetRequestLimiter.isAllowed(emailKey)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  next();
}

function passwordResetConfirmRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const emailKey = getScopedKey(req, req.body?.email);

  if (!passwordResetConfirmLimiter.isAllowed(ip) || !passwordResetConfirmLimiter.isAllowed(emailKey)) {
    return res.status(429).json({ error: '重置尝试过于频繁，请稍后再试' });
  }

  next();
}

function bindEmailSendRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const emailKey = getScopedKey(req, req.body?.email);

  if (!bindEmailSendLimiter.isAllowed(ip) || !bindEmailSendLimiter.isAllowed(emailKey)) {
    return res.status(429).json({ error: '验证码发送过于频繁，请稍后再试' });
  }

  next();
}

module.exports = {
  rateLimit,
  uploadRateLimit,
  emailVerifyRateLimit,
  loginRateLimit,
  tfaRateLimit,
  passwordResetRequestRateLimit,
  passwordResetConfirmRateLimit,
  bindEmailSendRateLimit
};
