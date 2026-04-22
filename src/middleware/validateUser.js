/**
 * 用户名验证中间件
 * 防止路径遍历攻击
 */
const log = require('../utils/logger');

/**
 * 验证用户名是否安全
 * @param {string} username - 用户名
 * @returns {boolean} - 是否安全
 */
function isUsernameSafe(username) {
  if (!username || typeof username !== 'string') {
    return false;
  }
  
  // 检查路径遍历字符
  if (username.includes('..') || username.includes('/') || username.includes('\\')) {
    return false;
  }
  
  // 检查是否包含控制字符
  if (/[\x00-\x1f\x80-\x9f]/.test(username)) {
    return false;
  }
  
  return true;
}

/**
 * 验证用户名中间件
 */
function validateUsername(req, res, next) {
  const username = req.user;
  
  if (!isUsernameSafe(username)) {
    log('ERROR', '检测到用户名路径遍历尝试', { username });
    return res.status(400).json({ error: 'Invalid username' });
  }
  
  next();
}

module.exports = {
  isUsernameSafe,
  validateUsername
};
