const path = require('path');

/**
 * 清理路径，防止路径遍历攻击
 * @param {string} inputPath - 输入路径
 * @param {boolean} allowTraversal - 是否允许向上遍历（默认false）
 * @returns {string} 清理后的安全路径
 * @throws {Error} 如果路径包含非法字符
 */
function sanitizePath(inputPath, allowTraversal = false) {
  if (typeof inputPath !== 'string') {
    throw new Error('路径必须是字符串');
  }

  // 移除空字符和空格
  const cleaned = inputPath.trim().replace(/\0/g, '');

  // 标准化路径
  const normalized = path.normalize(cleaned);

  // 检查路径遍历
  if (!allowTraversal && normalized.includes('..')) {
    throw new Error('路径包含非法字符，不允许向上遍历');
  }

  // 额外的安全检查
  if (normalized.includes('\0')) {
    throw new Error('路径包含空字符');
  }

  return normalized;
}

/**
 * 验证路径是否在指定基础路径内
 * @param {string} inputPath - 要验证的路径
 * @param {string} basePath - 基础路径
 * @returns {boolean} 路径是否安全
 */
function validatePath(inputPath, basePath) {
  try {
    const resolved = path.resolve(basePath, inputPath);
    const baseResolved = path.resolve(basePath);
    return resolved.startsWith(baseResolved);
  } catch (error) {
    return false;
  }
}

/**
 * 安全地构建文件路径
 * @param {string} basePath - 基础路径
 * @param {...string} segments - 路径段
 * @returns {string} 安全的完整路径
 * @throws {Error} 如果路径不安全
 */
function safePath(basePath, ...segments) {
  const joined = path.join(basePath, ...segments);
  const normalized = sanitizePath(joined);

  if (!validatePath(normalized, basePath)) {
    throw new Error('路径安全验证失败');
  }

  return normalized;
}

/**
 * 验证文件名是否安全
 * @param {string} filename - 文件名
 * @returns {boolean} 文件名是否安全
 */
function isValidFilename(filename) {
  if (typeof filename !== 'string') {
    return false;
  }

  // 检查文件名长度
  if (filename.length === 0 || filename.length > 255) {
    return false;
  }

  // 检查非法字符（Windows和Linux）
  const illegalChars = /[<>:"|?*\x00-\x1f]/;
  if (illegalChars.test(filename)) {
    return false;
  }

  // 检查保留名称（Windows）
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reservedNames.test(filename)) {
    return false;
  }

  // 检查路径遍历
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }

  // 检查以点开头（隐藏文件）
  if (filename.startsWith('.')) {
    return false;
  }

  return true;
}

/**
 * 清理文件名
 * @param {string} filename - 原始文件名
 * @returns {string} 清理后的安全文件名
 */
function sanitizeFilename(filename) {
  if (typeof filename !== 'string') {
    throw new Error('文件名必须是字符串');
  }

  // 移除路径部分
  const name = path.basename(filename);

  // 替换非法字符为下划线
  const cleaned = name
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/\.{2,}/g, '.');

  // 限制长度
  const maxLength = 200; // 留出空间给扩展名
  const ext = path.extname(cleaned);
  const baseName = path.basename(cleaned, ext);

  if (baseName.length > maxLength) {
    return baseName.substring(0, maxLength) + ext;
  }

  return cleaned;
}

module.exports = {
  sanitizePath,
  validatePath,
  safePath,
  isValidFilename,
  sanitizeFilename
};
