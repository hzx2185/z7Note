const RateLimiter = require('../utils/rateLimiter');

const globalLimiter = new RateLimiter(60000, 1000); // 每分钟最多1000个请求
const uploadLimiter = new RateLimiter(60000, 20); // 每分钟最多20个上传请求
const emailVerifyLimiter = new RateLimiter(60000, 10); // 每分钟最多10个邮箱验证请求

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

module.exports = { rateLimit, uploadRateLimit, emailVerifyRateLimit };
