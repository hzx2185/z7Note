const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const config = require('../config');

function genToken(len = 22) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len);
  let token = '';

  for (let i = 0; i < len; i++) {
    token += chars[bytes[i] % chars.length];
  }

  return token;
}

async function getUserFileSize(username) {
  const userDir = path.join(config.paths.uploads, username);
  let size = 0;
  try {
    const files = await fs.readdir(userDir);
    for (const f of files) {
      const s = await fs.stat(path.join(userDir, f));
      if (s.isFile()) size += s.size;
    }
  } catch (e) {
    // 用户目录不存在时返回0
  }
  return size;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

module.exports = {
  genToken,
  getUserFileSize,
  formatSize
};
