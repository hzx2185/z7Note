const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');

const config = require('../config');
const { auth, adminAuth } = require('../middleware/auth');
const securityHeaders = require('../middleware/security');
const { rateLimit } = require('../middleware/rateLimit');
const { createProxyMiddleware } = require('../services/cdnProxy');
const log = require('../utils/logger');

const authRoutes = require('../routes/auth');
const notesRoutes = require('../routes/notes');
const attachmentsRoutes = require('../routes/attachments');
const sharesRoutes = require('../routes/shares');
const adminRoutes = require('../routes/admin');
const userRoutes = require('../routes/user');
const sseRoutes = require('../routes/sse');
const userBackupRoutes = require('../routes/userBackup');
const todosRoutes = require('../routes/todos');
const eventsRoutes = require('../routes/events');
const caldavRoutes = require('../routes/caldav');
const carddavRoutes = require('../routes/carddav');
const webdavRoutes = require('../routes/webdav');
const contactsRoutes = require('../routes/contacts');
const timelineRoutes = require('../routes/timeline');
const lunarRoutes = require('../routes/lunar');
const { router: calendarSubscriptionsRoutes } = require('../routes/calendarSubscriptions');
const remindersRoutes = require('../routes/reminders');
const tfaRoutes = require('../routes/2fa');

const ROOT_DIR = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PUBLIC_EXACT_PATHS = new Set([
  '/',
  '/login.html',
  '/share.html',
  '/user.html',
  '/health',
  '/test-backup.html',
  '/favicon.ico',
  '/caldav',
  '/carddav',
  '/webdav',
  '/pricing',
  '/member',
  '/changelog',
  '/help'
]);
const PUBLIC_PATH_PREFIXES = [
  '/api/register', '/api/login', '/api/forgot-password', '/api/reset-password', '/api/verify-tfa',
  '/api/public/member-plans',
  '/api/share/public-list', '/api/share/public/', '/api/share/info', '/api/share/attachment', '/api/share/blog-info',
  '/s/', '/css/', '/js/', '/cdn/',
  '/caldav/', '/.well-known/caldav',
  '/carddav/', '/.well-known/carddav',
  '/webdav/',
  '/api/lunar',
];
const STATIC_CACHE_ONE_YEAR = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'];
const STATIC_CACHE_ONE_HOUR = ['.html', '.woff', '.woff2', '.ttf'];
const NO_CACHE_PAGES = [
  ['/', 'index.html'],
  ['/app', 'app.html'],
  ['/login.html', 'login.html'],
  ['/share.html', 'share.html'],
  ['/shares.html', 'shares.html'],
  ['/user.html', 'user.html'],
  ['/calendar.html', 'calendar.html'],
  ['/reminder-settings.html', 'reminder-settings.html'],
  ['/timeline.html', 'timeline.html'],
  ['/contacts.html', 'contacts.html'],
  ['/pricing', 'pricing.html'],
  ['/member', 'member.html'],
  ['/changelog', 'changelog.html'],
  ['/help', 'help.html'],
  ['/blog-settings.html', 'blog-settings.html'],
  ['/clear-cache.html', 'clear-cache.html']
];

function ensureWebDavMethods() {
  const methods = ['PROPFIND', 'REPORT', 'MKCALENDAR', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK'];
  methods.forEach(method => {
    if (!express.Router.prototype[method.toLowerCase()]) {
      express.Router.prototype[method.toLowerCase()] = function(routePath, handler) {
        return this.route(routePath)[method.toLowerCase()](handler);
      };
    }
  });
}

function setNoCachePageHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function jsonBodyMiddleware(req, res, next) {
  if (
    req.path.startsWith('/api/upload/chunk') ||
    req.path.startsWith('/caldav') ||
    req.path.startsWith('/carddav') ||
    req.path.startsWith('/webdav')
  ) {
    return next();
  }
  return express.json({ limit: '50mb' })(req, res, next);
}

function webDavBodyMiddleware(req, res, next) {
  if (req.method === 'PUT') {
    return express.raw({ type: '*/*', limit: '50mb' })(req, res, next);
  }
  if (req.method === 'PROPFIND') {
    return express.text({ type: 'application/xml', limit: '1mb' })(req, res, next);
  }
  return next();
}

function authGateMiddleware(req, res, next) {
  const isPublic = PUBLIC_EXACT_PATHS.has(req.path) ||
    PUBLIC_PATH_PREFIXES.some(routePath => req.path.startsWith(routePath));
  if (isPublic) {
    return next();
  }
  return auth(req, res, next);
}

function registerNoCachePages(app) {
  for (const [routePath, fileName] of NO_CACHE_PAGES) {
    app.get(routePath, (req, res) => {
      setNoCachePageHeaders(res);
      res.sendFile(path.join(PUBLIC_DIR, fileName));
    });
  }
}

function registerApiRoutes(app) {
  app.use(sharesRoutes);
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
  app.use('/api/user/backup', auth, userBackupRoutes);
}

function registerDavRoutes(app) {
  if (config.caldav.enabled) {
    app.use('/caldav', express.text({ type: '*/*', limit: '50mb' }));
    app.use('/caldav', caldavRoutes);
    log('INFO', 'CalDAV 服务已启用', { service: 'caldav', authMode: 'basic' });
    app.use('/.well-known/caldav', (req, res) => {
      res.redirect(302, '/caldav/');
    });
  }

  app.use('/carddav', express.text({ type: '*/*', limit: '50mb' }));
  app.use('/carddav', carddavRoutes);
  log('INFO', 'CardDAV 服务已启用', { service: 'carddav', authMode: 'basic' });
  app.use('/.well-known/carddav', (req, res) => {
    res.redirect(301, '/carddav/');
  });

  app.use('/webdav', webdavRoutes);
  log('INFO', 'WebDAV 服务已启用', { service: 'webdav', authMode: 'basic' });
}

function staticFileHeaders(res, filePath) {
  const ext = path.extname(filePath);
  if (STATIC_CACHE_ONE_YEAR.includes(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (STATIC_CACHE_ONE_HOUR.includes(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=600, must-revalidate');
  }
}

function buildApp() {
  ensureWebDavMethods();

  const app = express();
  app.set('trust proxy', 1);

  app.use(compression());
  app.use(jsonBodyMiddleware);
  app.use(express.urlencoded({ extended: false, limit: '50mb' }));
  app.use(cookieParser());
  app.use(rateLimit);
  app.use(securityHeaders);

  app.use('/api/upload/chunk', express.raw({ type: '*/*', limit: '50mb' }));
  app.use('/webdav', webDavBodyMiddleware);
  app.use(authGateMiddleware);

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/caldav/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'CalDAV',
      timestamp: Date.now(),
      version: '1.0'
    });
  });

  registerNoCachePages(app);
  registerApiRoutes(app);
  registerDavRoutes(app);

  sseRoutes.setupSSE(app);
  app.get('/cdn/:file', createProxyMiddleware());

  app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
  });

  app.use(express.static(PUBLIC_DIR, {
    setHeaders: staticFileHeaders,
    fallthrough: true
  }));

  app.use('/data', (req, res) => res.status(404).send('Not found'));
  return app;
}

module.exports = {
  buildApp
};
