require('dotenv').config();

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
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',

  // Cookie配置
  cookieName: 'z7note_user_session',
  cookieMaxAge: 2592000000, // 30天

  // 配额配置
  defaultNoteLimit: parseInt(process.env.DEFAULT_NOTE_LIMIT) || 10,
  defaultFileLimit: parseInt(process.env.DEFAULT_FILE_LIMIT) || 50,
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 500, // MB，默认500MB

  // 文件类型配置（逗号分隔的MIME类型）
  allowedFileTypes: (process.env.ALLOWED_FILE_TYPES ||
    'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,application/pdf,text/plain,text/markdown,' +
    'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
    'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
    'application/zip,application/x-rar-compressed,application/x-7z-compressed,' +
    'video/mp4,video/webm,audio/mpeg,audio/wav'
  ).split(',').map(t => t.trim()),

  // 分片上传配置
  chunkUpload: {
    enabled: process.env.CHUNK_UPLOAD_ENABLED !== 'false', // 默认开启
    chunkSize: parseInt(process.env.CHUNK_SIZE) || 5, // MB，每个分片大小
    maxRetries: parseInt(process.env.CHUNK_MAX_RETRIES) || 3, // 最大重试次数
  },

  // 图片压缩配置
  imageCompression: {
    enabled: process.env.IMAGE_COMPRESSION_ENABLED !== 'false', // 默认开启
    quality: parseInt(process.env.IMAGE_COMPRESSION_QUALITY) || 85, // 压缩质量 0-100
    maxWidth: parseInt(process.env.IMAGE_COMPRESSION_MAX_WIDTH) || 1920, // 最大宽度
    maxHeight: parseInt(process.env.IMAGE_COMPRESSION_MAX_HEIGHT) || 1080, // 最大高度
    formats: ['image/jpeg', 'image/png', 'image/webp'], // 支持的格式
  },

  // 动态限流配置
  dynamicUploadRateLimit: {
    enabled: process.env.DYNAMIC_RATE_LIMIT_ENABLED !== 'false', // 默认开启
    thresholds: [
      { maxSize: 10, limit: 30 },    // 10MB以下: 30次/分钟
      { maxSize: 50, limit: 20 },    // 10-50MB: 20次/分钟
      { maxSize: 100, limit: 10 },   // 50-100MB: 10次/分钟
      { maxSize: Infinity, limit: 5 } // 100MB以上: 5次/分钟
    ]
  },

  // 管理员用户
  adminUsers: (process.env.ADMIN_USER || 'admin').split(',').map(u => u.trim()),

  // 限流配置（兼容旧配置）
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
  
  // 路径配置
  paths: {
    root: ROOT_DIR,
    data: DATA_DIR,
    uploads: UPLOADS_DIR,
    backups: BACKUP_DIR,
    public: PUBLIC_DIR,
    logs: LOGS_DIR
  },
  
  // 验证必需的环境变量
  validateEnv() {
    const requiredEnvVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
    const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
    if (missingEnvVars.length > 0) {
      console.warn(`警告: 缺少以下环境变量: ${missingEnvVars.join(', ')}，邮件功能可能无法正常工作`);
    }
  }
};

config.validateEnv();

module.exports = config;
