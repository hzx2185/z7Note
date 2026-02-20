/**
 * Basic Auth 中间件
 * 用于 CalDAV 的基本认证
 */

const { getConnection } = require('../db/connection');
const log = require('../utils/logger');

/**
 * 验证 Basic Auth 凭据
 */
async function verifyBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const base64Credentials = authHeader.split(' ')[1];

    if (!base64Credentials || base64Credentials.trim() === '') {
      return null;
    }

    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const parts = credentials.split(':');
    if (parts.length < 2) {
        return null;
    }

    const username = parts.shift();
    const password = parts.join(':');

    if (!username || !password) {
      return null;
    }

    const user = await getConnection().get(
      `SELECT * FROM users WHERE username = ?`,
      [username]
    );

    if (!user) {
      log('DEBUG', 'Basic Auth 用户不存在', { username });
      return null;
    }

    const bcrypt = require('bcrypt');
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      log('DEBUG', 'Basic Auth 密码错误', { username, passwordLength: password.length });
      return null;
    }

    log('INFO', 'Basic Auth 验证成功', { username });
    return user;
  } catch (error) {
    log('ERROR', 'Basic Auth 验证失败', { error: error.message });
    return null;
  }
}

/**
 * Basic Auth 中间件
 */
async function basicAuthMiddleware(req, res, next) {
  if (req.user) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || authHeader === 'none' || authHeader.trim() === '') {
    res.setHeader('WWW-Authenticate', 'Basic realm="z7Note CalDAV"');
    return res.status(401).send('Unauthorized');
  }

  try {
    const user = await verifyBasicAuth(authHeader);
    if (!user) {
      res.setHeader('WWW-Authenticate', 'Basic realm="z7Note CalDAV"');
      return res.status(401).send('Unauthorized');
    }
    req.user = user.username;
    next();
  } catch (error) {
    log('ERROR', 'Basic Auth 验证异常', { error: error.message });
    res.setHeader('WWW-Authenticate', 'Basic realm="z7Note CalDAV"');
    res.status(401).send('Unauthorized');
  }
}

module.exports = {
  basicAuthMiddleware,
  verifyBasicAuth
};
