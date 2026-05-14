class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 100, options = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.lastCleanupAt = this.now();
  }

  cleanup(now = this.now()) {
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(t => t > windowStart);
      if (validTimestamps.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, validTimestamps);
      }
    }
    this.lastCleanupAt = now;
  }

  isAllowed(ip) {
    const now = this.now();
    const windowStart = now - this.windowMs;

    if (now - this.lastCleanupAt >= this.windowMs) {
      this.cleanup(now);
    }

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

  size() {
    return this.requests.size;
  }
}

module.exports = RateLimiter;
