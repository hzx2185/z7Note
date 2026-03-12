const { getConnection } = require('../db/connection');
const config = require('../config');

// 默认配置
const DEFAULT_CONFIG = {
  maxFileSize: { value: '500', description: '单个文件最大大小(MB)' },
  allowedFileTypes: {
    value: 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,application/pdf,text/plain,text/markdown,' +
           'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
           'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
           'application/zip,application/x-rar-compressed,application/x-7z-compressed,' +
           'video/mp4,video/webm,audio/mpeg,audio/wav',
    description: '允许的文件类型(MIME类型，逗号分隔)'
  },
  chunkUploadEnabled: { value: 'true', description: '是否启用分片上传' },
  chunkSize: { value: '5', description: '分片大小(MB)' },
  imageCompressionEnabled: { value: 'true', description: '是否启用图片压缩' },
  imageCompressionQuality: { value: '85', description: '图片压缩质量(0-100)' },
  imageCompressionMaxWidth: { value: '1920', description: '图片最大宽度(像素，0表示不限制)' },
  imageCompressionMaxHeight: { value: '1080', description: '图片最大高度(像素，0表示不限制)' },
  dynamicRateLimitEnabled: { value: 'true', description: '是否启用动态限流' },
  pdfMaxSize: { value: '10', description: 'PDF最大预览大小(MB)' },
  videoMaxSize: { value: '50', description: '视频最大预览大小(MB)' },
  audioMaxSize: { value: '20', description: '音频最大预览大小(MB)' },
  attachmentLazyLoad: { value: 'true', description: '是否启用附件懒加载' },
  attachmentAutoLoad: { value: 'false', description: '是否自动加载附件预览（点击加载）' },
  dailyBackupLimit: { value: '1', description: '每日备份限制(0=不限制, 1=每天1次)' },
  // SMTP 配置
  smtp_host: { value: 'localhost', description: 'SMTP 服务器地址' },
  smtp_port: { value: '587', description: 'SMTP 服务器端口' },
  smtp_secure: { value: 'false', description: '是否使用 SSL/TLS (true/false)' },
  smtp_user: { value: '', description: 'SMTP 用户名（邮箱地址）' },
  smtp_pass: { value: '', description: 'SMTP 密码或授权码' },
};

/**
 * 获取系统配置
 */
async function getSystemConfig(key) {
  const db = getConnection();
  const row = await db.get('SELECT value FROM system_config WHERE key = ?', [key]);

  if (row) {
    return row.value;
  }

  // 如果数据库中没有，返回默认配置
  const defaultConfig = DEFAULT_CONFIG[key];
  if (defaultConfig) {
    return defaultConfig.value;
  }

  return null;
}

/**
 * 获取所有系统配置
 */
async function getAllSystemConfig() {
  const db = getConnection();
  const rows = await db.all('SELECT key, value, description FROM system_config');
  const result = {};

  rows.forEach(row => {
    result[row.key] = {
      value: row.value,
      description: row.description
    };
  });

  // 补充默认配置中不存在的项
  Object.keys(DEFAULT_CONFIG).forEach(key => {
    if (!result[key]) {
      result[key] = {
        value: DEFAULT_CONFIG[key].value,
        description: DEFAULT_CONFIG[key].description,
        isDefault: true
      };
    }
  });

  return result;
}

/**
 * 设置系统配置
 */
async function setSystemConfig(key, value, description = null) {
  const db = getConnection();

  if (description) {
    await db.run(
      `INSERT INTO system_config (key, value, description, updatedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, description=excluded.description, updatedAt=excluded.updatedAt`,
      [key, value, description, Math.floor(Date.now() / 1000)]
    );
  } else {
    await db.run(
      `INSERT INTO system_config (key, value, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt`,
      [key, value, Math.floor(Date.now() / 1000)]
    );
  }
}

/**
 * 批量设置系统配置
 */
async function setMultipleSystemConfig(configs) {
  const db = getConnection();

  await db.run('BEGIN TRANSACTION');

  try {
    for (const [key, value] of Object.entries(configs)) {
      const defaultConfig = DEFAULT_CONFIG[key];
      await setSystemConfig(key, value, defaultConfig?.description);
    }
    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

/**
 * 删除系统配置（恢复默认值）
 */
async function deleteSystemConfig(key) {
  const db = getConnection();
  await db.run('DELETE FROM system_config WHERE key = ?', [key]);
}

/**
 * 获取有效的最大文件大小（字节）
 */
async function getMaxFileSize() {
  const value = await getSystemConfig('maxFileSize');
  const sizeMB = parseInt(value) || config.maxFileSize;
  return sizeMB * 1024 * 1024;
}

/**
 * 获取允许的文件类型列表
 */
async function getAllowedFileTypes() {
  const value = await getSystemConfig('allowedFileTypes');
  if (!value) return config.allowedFileTypes;
  return value.split(',').map(t => t.trim()).filter(t => t);
}

/**
 * 初始化默认配置
 */
async function initDefaultConfig() {
  const db = getConnection();
  const existingKeys = await db.all('SELECT key FROM system_config');
  const existingKeySet = new Set(existingKeys.map(r => r.key));

  for (const [key, config] of Object.entries(DEFAULT_CONFIG)) {
    if (!existingKeySet.has(key)) {
      await db.run(
        'INSERT INTO system_config (key, value, description, updatedAt) VALUES (?, ?, ?, ?)',
        [key, config.value, config.description, Math.floor(Date.now() / 1000)]
      );
    }
  }
}

/**
 * 获取 SMTP 配置
 */
async function getSmtpConfig() {
  const host = await getSystemConfig('smtp_host');
  const port = await getSystemConfig('smtp_port');
  const secure = await getSystemConfig('smtp_secure');
  const user = await getSystemConfig('smtp_user');
  const pass = await getSystemConfig('smtp_pass');

  return {
    host: host || 'localhost',
    port: parseInt(port) || 587,
    secure: secure === 'true',
    user: user || '',
    pass: pass || ''
  };
}

/**
 * 设置 SMTP 配置
 */
async function setSmtpConfig(config) {
  const configs = {
    smtp_host: config.host || '',
    smtp_port: String(config.port || 587),
    smtp_secure: config.secure ? 'true' : 'false',
    smtp_user: config.user || '',
    smtp_pass: config.pass || ''
  };

  await setMultipleSystemConfig(configs);
}

module.exports = {
  getSystemConfig,
  getAllSystemConfig,
  setSystemConfig,
  setMultipleSystemConfig,
  deleteSystemConfig,
  getMaxFileSize,
  getAllowedFileTypes,
  initDefaultConfig,
  getSmtpConfig,
  setSmtpConfig
};
