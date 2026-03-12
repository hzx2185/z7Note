const config = require('../config');
const { getSession, clearSessionCookie } = require('../services/session');

// 检测重定向循环
function checkRedirectLoop(req) {
  const referer = req.headers.referer || '';
  const currentPath = req.path;

  // 如果从登录页面重定向到登录页面，说明存在循环
  if (referer.includes('/login.html') && currentPath === '/login.html') {
    console.error('[AUTH] Detected redirect loop!');
    return true;
  }

  // 检查重定向历史
  const redirectHistory = req.headers['x-redirect-history'] || '';
  const redirects = redirectHistory.split(',').filter(Boolean);

  if (redirects.length > 5) {
    console.error('[AUTH] Too many redirects detected!');
    return true;
  }

  return false;
}

const auth = async (req, res, next) => {
  if (req.user) {
    return next();
  }

  const sessionId = req.cookies[config.cookieName];
  let user = null;

  try {
    const session = await getSession(sessionId);
    if (session) {
      user = session.username;
      req.sessionId = session.id;
    } else if (sessionId) {
      clearSessionCookie(req, res);
    }
  } catch (error) {
    console.error('[AUTH] Session lookup failed:', error);
    return res.status(500).json({ error: '会话校验失败，请稍后重试' });
  }

  // 管理员路由检查
  if (req.path.startsWith('/api/admin') || req.path === '/admin') {
    if (config.adminUsers.includes(user)) {
      req.user = user;
      return next();
    }
    return res.status(403).send('Forbidden');
  }

  // 有用户信息，放行
  if (user) {
    req.user = user;
    return next();
  }

  // 检测重定向循环
  if (checkRedirectLoop(req)) {
    return res.status(500).send(`
      <html>
      <head><title>重定向错误</title></head>
      <body style="font-family: Arial; padding: 20px; text-align: center;">
        <h1>检测到重定向循环</h1>
        <p>请清除浏览器Cookie后重试</p>
        <button onclick="location.reload()" style="padding: 10px 20px; cursor: pointer;">刷新页面</button>
        <script>
          // 清除所有Cookie
          document.cookie.split(";").forEach(function(c) {
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
          });
        </script>
      </body>
      </html>
    `);
  }

  // API请求返回401
  if (req.xhr || req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: "会话已过期，请重新登录" });
  }

  // 页面请求重定向到登录页
  res.redirect('/login.html');
};

const adminAuth = async (req, res, next) => {
  // 只对管理员路由进行检查
  if (!req.path.startsWith('/api/admin') && req.path !== '/admin') {
    return next();
  }

  let username = req.user;
  if (!username) {
    try {
      const session = await getSession(req.cookies[config.cookieName]);
      if (session) {
        username = session.username;
        req.sessionId = session.id;
      }
    } catch (error) {
      console.error('[AUTH] Admin session lookup failed:', error);
      return res.status(500).send('Internal Server Error');
    }
  }

  if (config.adminUsers.includes(username)) {
    req.user = username;
    next();
  } else {
    res.status(403).send('Forbidden');
  }
};

module.exports = { auth, adminAuth };
