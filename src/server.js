const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const nodeCron = require('node-cron');

// 为 Express 添加 WebDAV 方法支持
const webdavMethods = ['PROPFIND', 'REPORT', 'MKCALENDAR', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK'];
webdavMethods.forEach(method => {
  express.Router.prototype[method.toLowerCase()] = function(path, handler) {
    return this.route(path)[method.toLowerCase()](handler);
  };
});

const config = require('./config');
const { connect, getConnection, close } = require('./db/connection');
const { auth, adminAuth } = require('./middleware/auth');
const securityHeaders = require('./middleware/security');
const { rateLimit } = require('./middleware/rateLimit');
const { setupCron, getBackupConfig } = require('./services/backup');
const { initCacheDir, updateAllResources, createProxyMiddleware, setupAutoUpdate } = require('./services/cdnProxy');
const { initWebSocketServer } = require('./routes/ws');
const { initDefaultConfig } = require('./services/systemConfig');
const { cleanupExpiredSessions, initChunksDir } = require('./services/chunkUpload');
const { cleanupAllLimiters } = require('./utils/dynamicRateLimiter');
const { setupUserBackupCron, getUserBackupConfig } = require('./services/userExport');
const { checkAndSendPendingReminders } = require('./services/reminderService');

const app = express();
app.set('trust proxy', 1); // 信任反向代理，用于正确识别 https
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// 中间件配置
// JSON body 解析器（跳过分片上传路由和 DAV 路由）
app.use((req, res, next) => {
  if (req.path.startsWith('/api/upload/chunk') || req.path.startsWith('/caldav') || req.path.startsWith('/carddav') || req.path.startsWith('/webdav')) {
    // 跳过 JSON 解析，让后面的 raw 中间件或 DAV 路由自己处理
    next();
  } else {
    express.json({ limit: '50mb' })(req, res, next);
  }
});

app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(cookieParser());
app.use(rateLimit);
app.use(securityHeaders);

// 为分片上传添加 raw body 解析
app.use('/api/upload/chunk', express.raw({ type: '*/*', limit: '50mb' }));

// 为 WebDAV 请求添加 body 解析
app.use('/webdav', (req, res, next) => {
  if (req.method === 'PUT') {
    // PUT 请求使用 raw body
    express.raw({ type: '*/*', limit: '50mb' })(req, res, next);
  } else if (req.method === 'PROPFIND') {
    // PROPFIND 请求解析 XML body
    express.text({ type: 'application/xml', limit: '1mb' })(req, res, next);
  } else {
    next();
  }
});

// 认证中间件 - 保护需要认证的路由
app.use((req, res, next) => {
  const publicPaths = [
    '/login.html', '/share.html', '/user.html',
    '/api/register', '/api/login', '/api/forgot-password', '/api/reset-password', '/api/verify-tfa',
    '/api/send-bind-code', '/api/verify-bind-email',
    '/api/share/public-list', '/api/share/public/', '/api/share/info', '/api/share/attachment', '/api/share/blog-info',
    '/s/', '/health', '/test-backup.html',
    '/favicon.ico', '/css/', '/js/', '/cdn/',
    '/caldav/', '/caldav', '/.well-known/caldav',  // CalDAV 路由使用 Basic Auth，不需要 Cookie 认证
    '/carddav/', '/carddav', '/.well-known/carddav',  // CardDAV 路由使用 Basic Auth，不需要 Cookie 认证
    '/webdav/', '/webdav',  // WebDAV 路由使用 Basic Auth，不需要 Cookie 认证
    '/api/lunar',  // 农历API公开访问
    '/calendar.html', '/reminder-settings.html', '/contacts.html'  // 日历、提醒设置和联系人页面
  ];

  const isPublic = publicPaths.some(path => req.path.startsWith(path));

  if (isPublic) {
    next();
  } else {
    auth(req, res, next);
  }
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// 注册路由
const authRoutes = require('./routes/auth');
const notesRoutes = require('./routes/notes');
const attachmentsRoutes = require('./routes/attachments');
const sharesRoutes = require('./routes/shares');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const sseRoutes = require('./routes/sse');
const userBackupRoutes = require('./routes/userBackup');
const todosRoutes = require('./routes/todos');
const eventsRoutes = require('./routes/events');
const caldavRoutes = require('./routes/caldav');
const carddavRoutes = require('./routes/carddav');
const webdavRoutes = require('./routes/webdav');
const contactsRoutes = require('./routes/contacts');
const timelineRoutes = require('./routes/timeline');
const lunarRoutes = require('./routes/lunar');
const calendarSubscriptionsRoutes = require('./routes/calendarSubscriptions');
const remindersRoutes = require('./routes/reminders');
const tfaRoutes = require('./routes/2fa');

// 分享路由必须在静态文件之前注册，否则 /s/ 会被当作静态目录处理
app.use(sharesRoutes);

// 公开页面路由 - 禁用缓存
app.get('/login.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});
app.get('/share.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'share.html'));
});
app.get('/shares.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'shares.html'));
});
app.get('/user.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'user.html'));
});
app.get('/calendar.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'calendar.html'));
});

app.get('/reminder-settings.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'reminder-settings.html'));
  });
  app.get('/timeline.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(PUBLIC_DIR, 'timeline.html'));
});
app.get('/contacts.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'contacts.html'));
});

app.use(authRoutes);
app.use(notesRoutes);
app.use(attachmentsRoutes);
app.use(adminAuth, adminRoutes);
app.use(userRoutes);
app.use(todosRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/timeline', timelineRoutes);
app.use('/api/lunar', lunarRoutes);
app.use('/api/calendar-subscriptions', calendarSubscriptionsRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/2fa', tfaRoutes);
app.use('/api/contacts', contactsRoutes);

// CalDAV 路由（使用 Basic Auth）
if (config.caldav.enabled) {
  app.use('/caldav', caldavRoutes);
  console.log('[CalDAV] CalDAV 服务已启用 (Basic Auth)');

  // .well-known/caldav 支持（用于自动发现）
  app.use('/.well-known/caldav', (req, res) => {
    res.redirect(302, '/caldav/');
  });
}

  // CardDAV 路由（使用 Basic Auth）
  app.use('/carddav', carddavRoutes);
  console.log('[CardDAV] CardDAV 服务已启用 (Basic Auth)');

  // .well-known/carddav 支持（用于自动发现）
  app.use('/.well-known/carddav', (req, res) => {
    res.redirect(302, '/carddav/');
  });

  // WebDAV 路由（使用 Basic Auth）
  app.use('/webdav', webdavRoutes);
  console.log('[WebDAV] WebDAV 服务已启用 (Basic Auth)');

// 设置 SSE 路由
sseRoutes.setupSSE(app);

// CDN 代理路由 - 在静态文件之前
app.get('/cdn/:file', createProxyMiddleware());

// 页面路由（需要认证）- 禁用缓存
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.get('/blog-settings.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'blog-settings.html'));
});
app.get('/admin', adminAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/clear-cache.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'clear-cache.html'));
});

// 静态文件（智能缓存策略）
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath);

    // 对于有版本号的资源（带 ?v= 参数的），使用长期缓存
    // 这允许浏览器缓存，但版本号改变时会强制重新下载
    if (['.css', '.js'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'].includes(ext)) {
      // 图片资源长期缓存
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (['.html', '.woff', '.woff2', '.ttf'].includes(ext)) {
      // HTML 和字体文件短期缓存，允许验证
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    } else {
      // 其他文件短期缓存
      res.setHeader('Cache-Control', 'public, max-age=600, must-revalidate');
    }
  },
  // 不作为回退，404时跳过
  fallthrough: true
}));

// 保护数据目录
app.use('/data', (req, res) => res.status(404).send('Not found'));

// 启动服务器
let server;
(async () => {
  try {
    await connect();

    // 初始化默认系统配置
    await initDefaultConfig();

    // 初始化分片上传目录
    await initChunksDir();

    // 初始化 CDN 缓存目录
    await initCacheDir();

    // 设置定时备份任务
    const backupConfig = await getBackupConfig();
    if (backupConfig) {
      setupCron(backupConfig);
    }

    // 初始化用户备份任务
    const db = getConnection();
    const users = await db.all('SELECT username FROM users');
    for (const user of users) {
      const userBackupConfig = await getUserBackupConfig(user.username);
      if (userBackupConfig && userBackupConfig.enabled) {
        setupUserBackupCron(user.username, userBackupConfig);
      }
    }

    // 设置 CDN 自动更新任务
    setupAutoUpdate();

    // 设置提醒定时任务 - 每分钟检查一次
    nodeCron.schedule('* * * * *', async () => {
      try {
        await checkAndSendPendingReminders();
      } catch (e) {
        console.error('[定时任务] 提醒检查失败:', e);
      }
    });
    console.log('[定时任务] 提醒服务已启动 (每分钟检查一次)');

    // 设置定时清理过期上传会话（每小时）
    nodeCron.schedule('0 * * * *', async () => {
      try {
        const count = await cleanupExpiredSessions();
        console.log(`[定时任务] 清理过期上传会话: ${count}个`);
      } catch (e) {
        console.error('[定时任务] 清理失败:', e);
      }
    });

    server = app.listen(config.port, config.host, () => {
      console.log(`z7Note Server running on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
      console.log(`系统配额 - 笔记: ${config.defaultNoteLimit}MB, 附件: ${config.defaultFileLimit}MB`);
      console.log(`CDN 代理已启用，缓存目录: ${config.paths.data}/cdn-cache`);
      console.log(`最大文件大小: ${config.maxFileSize}MB`);
      console.log(`提醒服务已启用，支持邮件、浏览器和CalDAV提醒`);
    });

    // 初始化WebSocket服务器
    initWebSocketServer(server);
  } catch (err) {
    console.error("启动失败:", err);
    process.exit(1);
  }
})();

// 优雅关闭
const shutdown = async (signal) => {
  console.log(`收到 ${signal} 信号，准备安全关闭...`);
  if (server) server.close(() => console.log('HTTP 服务已停止'));
  cleanupAllLimiters();
  await close();
  setTimeout(() => process.exit(0), 500);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
