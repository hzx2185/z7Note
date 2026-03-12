require('dotenv').config();

// 强制设置默认时区为上海
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

const path = require('path');
const nodeFs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');

// 确保日志目录存在
nodeFs.mkdirSync(LOGS_DIR, { recursive: true });

const config = {
  // 服务器配置
  port: parseInt(process.env.PORT) || 80,
  host: process.env.HOST || '0.0.0.0',

  // Cookie配置
  cookieName: 'z7note_user_session',
  cookieMaxAge: 2592000000, // 30天
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: process.env.COOKIE_SECURE === 'true',

  // 配额配置 (默认 100MB 笔记, 500MB 附件)
  defaultNoteLimit: parseInt(process.env.DEFAULT_NOTE_LIMIT) || 100,
  defaultFileLimit: parseInt(process.env.DEFAULT_FILE_LIMIT) || 500,
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 500, // MB

  // 文件类型配置
  allowedFileTypes: (process.env.ALLOWED_FILE_TYPES ||
    'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,application/pdf,text/plain,text/markdown,' +
    'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
    'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
    'application/zip,application/x-rar-compressed,application/x-7z-compressed,' +
    'video/mp4,video/webm,audio/mpeg,audio/wav'
  ).split(',').map(t => t.trim()),

  // 分片上传配置
  chunkUpload: {
    enabled: process.env.CHUNK_UPLOAD_ENABLED !== 'false',
    chunkSize: parseInt(process.env.CHUNK_SIZE) || 5,
    maxRetries: parseInt(process.env.CHUNK_MAX_RETRIES) || 3,
  },

  // 图片压缩配置
  imageCompression: {
    enabled: process.env.IMAGE_COMPRESSION_ENABLED !== 'false',
    quality: parseInt(process.env.IMAGE_COMPRESSION_QUALITY) || 85,
    maxWidth: parseInt(process.env.IMAGE_COMPRESSION_MAX_WIDTH) || 1920,
    maxHeight: parseInt(process.env.IMAGE_COMPRESSION_MAX_HEIGHT) || 1080,
    formats: ['image/jpeg', 'image/png', 'image/webp'],
  },

  // 动态限流配置
  dynamicUploadRateLimit: {
    enabled: process.env.DYNAMIC_RATE_LIMIT_ENABLED !== 'false',
    thresholds: [
      { maxSize: 10, limit: 30 },
      { maxSize: 50, limit: 20 },
      { maxSize: 100, limit: 10 },
      { maxSize: Infinity, limit: 5 }
    ]
  },

  // 附件预览配置
  attachmentPreview: {
    enabled: process.env.ATTACHMENT_PREVIEW_ENABLED !== 'false',
    lazyLoad: process.env.ATTACHMENT_LAZY_LOAD !== 'false',
    autoLoad: process.env.ATTACHMENT_AUTO_LOAD === 'true',
    pdfMaxSize: parseInt(process.env.PDF_MAX_SIZE) || 10,
    videoMaxSize: parseInt(process.env.VIDEO_MAX_SIZE) || 50,
    audioMaxSize: parseInt(process.env.AUDIO_MAX_SIZE) || 20,
  },

  // 管理员用户 (默认为 admin)
  adminUsers: (process.env.ADMIN_USER || 'admin').split(',').map(u => u.trim()),

  // 每日备份限制 (默认不限制: 0)
  dailyBackupLimit: process.env.DAILY_BACKUP_LIMIT !== undefined ? parseInt(process.env.DAILY_BACKUP_LIMIT) : 0,

  // 限流配置
  rateLimit: {
    windowMs: 60000,
    maxRequests: 1000,
    uploadMax: parseInt(process.env.UPLOAD_RATE_LIMIT) || 20
  },
  
  // SMTP配置
  smtp: {
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  },

  // CalDAV配置
  caldav: {
    enabled: process.env.CALDAV_ENABLED !== 'false',
    basePath: process.env.CALDAV_BASE || '/caldav'
  },

  // CardDAV配置 (默认启用)
  carddav: {
    enabled: process.env.CARDDAV_ENABLED !== 'false',
    basePath: process.env.CARDDAV_BASE || '/carddav'
  },

  // JWT 配置 (不提供则生成随机密钥)
  jwt: {
    secret: process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex'),
    expiresIn: '2h'
  },
  
  // 路径配置
  paths: {
    root: ROOT_DIR,
    data: DATA_DIR,
    uploads: UPLOADS_DIR,
    backups: BACKUP_DIR,
    public: PUBLIC_DIR,
    logs: LOGS_DIR,
    database: path.join(DATA_DIR, 'z7note.db')
  },
  
  // 验证必需的环境变量
  validateEnv() {
    if (!process.env.SMTP_HOST) {
      console.warn('⚠️  警告: 缺少 SMTP 邮箱配置，邮件功能将无法正常工作');
    }
  }
};

config.validateEnv();
module.exports = config;
