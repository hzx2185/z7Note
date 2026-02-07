function securityHeaders(req, res, next) {
  // 严格传输安全 (HSTS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // 内容类型选项
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // 点击劫持防护
  res.setHeader('X-Frame-Options', 'DENY');
  
  // XSS防护
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // 引用策略
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // 内容安全策略 (所有资源已本地化，无需允许外部 CDN)
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);

  next();
}

module.exports = securityHeaders;
