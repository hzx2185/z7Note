class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();
  }

  isAllowed(ip) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    if (!this.requests.has(ip)) {
      this.requests.set(ip, []);
    }

    const timestamps = this.requests.get(ip);
    // 移除超出窗口的请求
    const validTimestamps = timestamps.filter(t => t > windowStart);

    if (validTimestamps.length >= this.maxRequests) {
      return false;
    }

    validTimestamps.push(now);
    this.requests.set(ip, validTimestamps);
    return true;
  }

  reset(ip) {
    this.requests.delete(ip);
  }
}

module.exports = RateLimiter;
