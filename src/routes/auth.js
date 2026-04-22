const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const db = require('../db/client');
const config = require('../config');
const { sanitizeInput, validateUsername } = require('../utils/validators');
const {
  findLoginUser,
  updateUserPassword
} = require('../services/authAccount');
const log = require('../utils/logger');
const { AUTH_EVENTS } = require('../constants/securityEvents');
const { loginRateLimit, tfaRateLimit } = require('../middleware/rateLimit');
const { createSession, destroySession, destroyUserSessions, getSessionCookieOptions, clearSessionCookie } = require('../services/session');
const emailBindingRoutes = require('./auth/emailBinding');
const passwordRecoveryRoutes = require('./auth/passwordRecovery');

const router = express.Router();

// 注册
router.post('/api/register', async (req, res) => {
  const { user, pass, adminToken } = req.body;
  try {
    if (!user || !pass) {
      return res.status(400).json({ error: "用户名和密码不能为空" });
    }
    if (!validateUsername(user)) {
      return res.status(400).json({ error: "用户名必须是3-20个字符，只允许字母、数字、下划线" });
    }
    if (pass.length < 6) {
      return res.status(400).json({ error: "密码至少需要6个字符" });
    }

    const sanitizedUser = sanitizeInput(user, 20);
    const hashedPassword = await bcrypt.hash(sanitizeInput(pass, 100), 10);
    const isTargetAdmin = config.adminUsers.includes(sanitizedUser);

    if (isTargetAdmin && config.requireAdminRegistrationToken) {
      const normalizedAdminToken = typeof adminToken === 'string' ? adminToken.trim() : '';
      if (!normalizedAdminToken || normalizedAdminToken !== config.adminRegistrationToken) {
        log('WARN', '管理员初始化注册校验失败', {
          event: AUTH_EVENTS.ADMIN_REGISTRATION_REJECTED,
          username: sanitizedUser,
          ip: req.ip || req.connection?.remoteAddress || 'unknown'
        });
        return res.status(403).json({ error: "注册请求未通过校验" });
      }
    }

    await db.execute('INSERT INTO users (username, password, planKey, noteLimit, fileLimit) VALUES (?, ?, ?, ?, ?)',
      [sanitizedUser, hashedPassword, isTargetAdmin ? 'team' : 'free', isTargetAdmin ? 1000 : config.defaultNoteLimit,
       isTargetAdmin ? 5000 : config.defaultFileLimit]);
    const session = await createSession(sanitizedUser);
    res.cookie(config.cookieName, session.id, getSessionCookieOptions(req));
    res.json({ status: "ok" });
    log('INFO', '用户注册成功', { username: sanitizedUser });
  } catch (e) {
    log('ERROR', '注册失败', {
      event: AUTH_EVENTS.REGISTRATION_FAILED,
      username: user,
      error: e.message
    });
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: "用户名已存在" });
    }
    res.status(500).json({ error: "注册失败，请稍后重试" });
  }
});

// 登录
router.post('/api/login', loginRateLimit, async (req, res) => {
  const { user, pass } = req.body;
  try {
    if (!user || !pass) {
      return res.status(400).json({ error: "用户名和密码不能为空" });
    }

    const sanitizedUser = sanitizeInput(user, 50);
    const { user: row, matchedUsers } = await findLoginUser(sanitizedUser);

    if (matchedUsers && matchedUsers.length > 1) {
      return res.status(409).json({ error: "该邮箱绑定了多个账户，请改用用户名登录并尽快清理重复邮箱" });
    }

    if (row && await bcrypt.compare(sanitizeInput(pass, 100), row.password)) {
      // 密码正确，检查是否需要2FA
      if (row.tfa_enabled) {
        const tempToken = jwt.sign({ username: row.username }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
        return res.json({ status: "tfa_required", tempToken });
      } else {
        const session = await createSession(row.username);
        res.cookie(config.cookieName, session.id, getSessionCookieOptions(req));
        return res.json({ status: "ok" });
      }
    }
    res.status(403).json({ error: "账号或密码错误" });
  } catch (e) {
    log('ERROR', '登录失败', {
      event: AUTH_EVENTS.LOGIN_FAILED,
      username: user,
      error: e.message,
      stack: e.stack
    });
    res.status(500).json({ error: "服务器内部错误" });
  }
});

// 验证2FA并完成登录
router.post('/api/verify-tfa', tfaRateLimit, async (req, res) => {
  const { tempToken, tfaToken } = req.body;
  if (!tempToken || !tfaToken) {
    return res.status(400).json({ error: '缺少临时令牌或2FA验证码' });
  }

  try {
    const decoded = jwt.verify(tempToken, config.jwt.secret);
    const username = decoded.username;

    // 获取用户2FA密钥和备用代码
    const user = await db.queryOne('SELECT tfa_secret, tfa_backup_codes FROM users WHERE username = ? AND tfa_enabled = 1', [username]);

    if (!user || !user.tfa_secret) {
      return res.status(401).json({ error: '无法验证2FA，请重新登录' });
    }

    let isValid = false;
    let usedBackupCode = false;

    // 首先尝试验证为备用代码
    if (user.tfa_backup_codes) {
      try {
        const backupCodes = JSON.parse(user.tfa_backup_codes);
        const codeIndex = backupCodes.indexOf(tfaToken.toUpperCase());
        if (codeIndex !== -1) {
          // 找到备用代码，从列表中移除已使用的代码
          backupCodes.splice(codeIndex, 1);
          await db.execute(
            'UPDATE users SET tfa_backup_codes = ? WHERE username = ?',
            [JSON.stringify(backupCodes), username]
          );
          isValid = true;
          usedBackupCode = true;
        }
      } catch (e) {
        log('ERROR', '解析备用代码失败', {
          event: AUTH_EVENTS.TFA_VERIFICATION_FAILED,
          username,
          error: e.message,
          stack: e.stack
        });
      }
    }

    // 如果不是备用代码，尝试验证为普通验证码
    if (!isValid) {
      const window = 2;
      for (let i = -window; i <= window; i++) {
        const delta = authenticator.verify({
          token: tfaToken,
          secret: user.tfa_secret,
          window: [i, i]
        });
        if (delta !== null) {
          isValid = true;
          break;
        }
      }
    }

    if (isValid) {
      const session = await createSession(username);
      res.cookie(config.cookieName, session.id, getSessionCookieOptions(req));
      return res.json({ status: "ok", usedBackupCode });
    } else {
      return res.status(401).json({ error: '2FA验证码无效' });
    }
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: '会话已过期，请重新登录' });
    }
    if (e instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: '无效的会话，请重新登录' });
    }
    log('ERROR', '2FA验证失败', {
      event: AUTH_EVENTS.TFA_VERIFICATION_FAILED,
      error: e.message,
      stack: e.stack
    });
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// 登出
router.post('/api/logout', async (req, res) => {
  try {
    const sessionId = req.cookies[config.cookieName];
    await destroySession(sessionId);
    clearSessionCookie(req, res);
    res.json({ status: 'ok' });
  } catch (error) {
    log('ERROR', '登出失败', {
      event: AUTH_EVENTS.LOGOUT_FAILED,
      error: error.message
    });
    res.status(500).json({ error: '登出失败' });
  }
});

router.use(emailBindingRoutes);
router.use(passwordRecoveryRoutes);

// 已登录用户修改密码
router.post('/api/change-password', async (req, res) => {
  try {
    const { oldPass, newPass } = req.body;
    
    if (!oldPass || !newPass) {
      return res.status(400).json({ error: "旧密码和新密码不能为空" });
    }
    
    if (newPass.length < 6) {
      return res.status(400).json({ error: "新密码至少需要6个字符" });
    }
    
    // 获取当前用户
    const user = await db.queryOne('SELECT * FROM users WHERE username = ?', [req.user]);
    
    if (!user) {
      return res.status(404).json({ error: "用户不存在" });
    }
    
    // 验证旧密码
    const isOldPassValid = await bcrypt.compare(sanitizeInput(oldPass, 100), user.password);
    if (!isOldPassValid) {
      return res.status(400).json({ error: "旧密码错误" });
    }
    
    // 更新新密码
    const hashedNewPassword = await bcrypt.hash(newPass, 10);
    await db.execute('UPDATE users SET password = ? WHERE username = ?', [hashedNewPassword, req.user]);
    await destroyUserSessions(req.user);

    const session = await createSession(req.user);
    res.cookie(config.cookieName, session.id, getSessionCookieOptions(req));
    
    log('INFO', '用户密码修改成功', { username: req.user });
    res.json({ status: "ok" });
  } catch (e) {
    log('ERROR', '密码修改失败', {
      event: AUTH_EVENTS.PASSWORD_CHANGE_FAILED,
      username: req.user,
      error: e.message
    });
    res.status(500).json({ error: "密码修改失败，请稍后重试" });
  }
});

module.exports = router;
