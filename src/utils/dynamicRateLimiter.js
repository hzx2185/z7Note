const { getSystemConfig } = require('../services/systemConfig');

// 存储每个IP的限流器
const limiters = new Map();

/**
 * 获取适合的限流值
 * @param {number} fileSize - 文件大小（字节）
 * @returns {number} 限流值（每分钟请求数）
 */
async function getUploadLimit(fileSize) {
  const enabled = await getSystemConfig('dynamicRateLimitEnabled');
  if (enabled === 'false') {
    // 禁用动态限流，返回固定值
    return parseInt(await getSystemConfig('uploadRateLimit')) || 20;
  }

  // 计算文件大小（MB）
  const sizeMB = fileSize / (1024 * 1024);

  // 默认阈值配置
  const thresholds = [
    { maxSize: 10, limit: 30 },    // 10MB以下: 30次/分钟
    { maxSize: 50, limit: 20 },    // 10-50MB: 20次/分钟
    { maxSize: 100, limit: 10 },   // 50-100MB: 10次/分钟
    { maxSize: Infinity, limit: 5 } // 100MB以上: 5次/分钟
  ];

  // 查找适合的限流值
  for (const threshold of thresholds) {
    if (sizeMB < threshold.maxSize) {
      return threshold.limit;
    }
  }

  return 5; // 默认最严格的限制
}

/**
 * IP限流器类
 */
class IPLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), windowMs);
  }

  isAllowed(ip) {
    const now = Date.now();
    const ipRequests = this.requests.get(ip) || [];

    // 清理过期的请求记录
    const validRequests = ipRequests.filter(time => now - time < this.windowMs);

    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    // 添加新的请求记录
    validRequests.push(now);
    this.requests.set(ip, validRequests);

    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [ip, requests] of this.requests.entries()) {
      const validRequests = requests.filter(time => now - time < this.windowMs);
      if (validRequests.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, validRequests);
      }
    }
  }

  updateLimit(maxRequests) {
    this.maxRequests = maxRequests;
  }

  reset(ip) {
    this.requests.delete(ip);
  }
}

/**
 * 获取或创建限流器
 */
function getLimiter(ip, maxRequests) {
  if (!limiters.has(ip)) {
    const limiter = new IPLimiter(60000, maxRequests); // 1分钟窗口
    limiters.set(ip, limiter);
  }
  return limiters.get(ip);
}

/**
 * 动态上传限流中间件
 */
async function dynamicUploadRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;

  // 从请求头获取文件大小（用于预估）
  const fileSize = parseInt(req.headers['x-file-size']) || 0;

  // 获取适合的限流值
  const maxRequests = await getUploadLimit(fileSize);

  // 获取或创建限流器
  const limiter = getLimiter(ip, maxRequests);

  // 更新限流器的限制值
  limiter.updateLimit(maxRequests);

  // 检查是否允许请求
  if (!limiter.isAllowed(ip)) {
    return res.status(429).json({
      error: `上传过于频繁，请稍后再试（限流: ${maxRequests}次/分钟）`
    });
  }

  // 在响应头中添加限流信息
  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', maxRequests - limiter.requests.get(ip)?.length || maxRequests);

  next();
}

/**
 * 基于文件大小的限流中间件工厂
 */
function createFileBasedUploadLimitMiddleware() {
  return async function (req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;

    // 尝试从多个来源获取文件大小
    let fileSize = 0;

    // 1. 从请求头获取
    if (req.headers['x-file-size']) {
      fileSize = parseInt(req.headers['x-file-size']) || 0;
    }
    // 2. 从 Content-Length 获取
    else if (req.headers['content-length']) {
      fileSize = parseInt(req.headers['content-length']) || 0;
    }
    // 3. 从 req.file 获取（multer处理后）
    else if (req.file && req.file.size) {
      fileSize = req.file.size;
    }

    // 如果是分片上传，从请求体获取
    if (!fileSize && req.body && req.body.totalSize) {
      fileSize = parseInt(req.body.totalSize) || 0;
    }

    // 获取适合的限流值
    const maxRequests = await getUploadLimit(fileSize);

    // 获取或创建限流器
    const limiter = getLimiter(ip, maxRequests);

    // 更新限流器的限制值
    limiter.updateLimit(maxRequests);

    // 检查是否允许请求
    if (!limiter.isAllowed(ip)) {
      return res.status(429).json({
        error: `上传过于频繁，请稍后再试（限流: ${maxRequests}次/分钟）`
      });
    }

    // 在响应头中添加限流信息
    res.setHeader('X-RateLimit-Limit', maxRequests);

    next();
  };
}

/**
 * 清理所有限流器
 */
function cleanupAllLimiters() {
  for (const limiter of limiters.values()) {
    clearInterval(limiter.cleanupInterval);
  }
  limiters.clear();
}

module.exports = {
  getUploadLimit,
  dynamicUploadRateLimit,
  createFileBasedUploadLimitMiddleware,
  cleanupAllLimiters
};
