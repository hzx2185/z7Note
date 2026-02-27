function securityHeaders(req, res, next) {
  // CalDAV/CardDAV 路由跳过大部分安全头，避免干扰客户端
  if (req.path.startsWith('/caldav') || req.path.startsWith('/.well-known/caldav') ||
      req.path.startsWith('/carddav') || req.path.startsWith('/.well-known/carddav')) {
    // 只保留基本的 HSTS
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return next();
  }

  // 严格传输安全 (HSTS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // 内容类型选项
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // 点击劫持防护 - 允许同源iframe嵌入（用于PDF预览等）
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  
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
    "connect-src 'self' https://wttr.in",
    "frame-src 'self'", // 允许同源iframe
    "worker-src 'self' blob:",
    "manifest-src 'self'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  
  next();
}

module.exports = securityHeaders;
