const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const { getConnection } = require('../db/connection');
const config = require('../config');
const { sanitizeInput, validateUsername, validateEmail, validatePassword } = require('../utils/validators');
const { sendMail } = require('../services/mailer');
const { genToken } = require('../utils/helpers');
const log = require('../utils/logger');
const { emailVerifyRateLimit } = require('../middleware/rateLimit');
const { createSession, destroySession, destroyUserSessions, getSessionCookieOptions, clearSessionCookie } = require('../services/session');

const router = express.Router();

// 注册
router.post('/api/register', async (req, res) => {
  const { user, pass } = req.body;
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
    await getConnection().run('INSERT INTO users (username, password, noteLimit, fileLimit) VALUES (?, ?, ?, ?)',
      [sanitizedUser, hashedPassword, isTargetAdmin ? 1000 : config.defaultNoteLimit, 
       isTargetAdmin ? 5000 : config.defaultFileLimit]);
    const session = await createSession(sanitizedUser);
    res.cookie(config.cookieName, session.id, getSessionCookieOptions(req));
    res.json({ status: "ok" });
    log('INFO', '用户注册成功', { username: sanitizedUser });
  } catch (e) {
    log('ERROR', '注册失败', { username: user, error: e.message });
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: "用户名已存在" });
    }
    res.status(500).json({ error: "注册失败，请稍后重试" });
  }
});

// 登录
router.post('/api/login', async (req, res) => {
  const { user, pass } = req.body;
  try {
    if (!user || !pass) {
      return res.status(400).json({ error: "用户名和密码不能为空" });
    }

    const sanitizedUser = sanitizeInput(user, 50);
    const row = await getConnection().get('SELECT * FROM users WHERE username = ? OR email = ?', 
      [sanitizedUser, sanitizedUser]);

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
    console.error('登录失败:', e);
    res.status(500).json({ error: "服务器内部错误" });
  }
});

// 验证2FA并完成登录
router.post('/api/verify-tfa', async (req, res) => {
  const { tempToken, tfaToken } = req.body;
  if (!tempToken || !tfaToken) {
    return res.status(400).json({ error: '缺少临时令牌或2FA验证码' });
  }

  try {
    const decoded = jwt.verify(tempToken, config.jwt.secret);
    const username = decoded.username;

    // 获取用户2FA密钥和备用代码
    const db = getConnection();
    const user = await db.get('SELECT tfa_secret, tfa_backup_codes FROM users WHERE username = ? AND tfa_enabled = 1', [username]);

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
          await db.run(
            'UPDATE users SET tfa_backup_codes = ? WHERE username = ?',
            [JSON.stringify(backupCodes), username]
          );
          isValid = true;
          usedBackupCode = true;
        }
      } catch (e) {
        console.error('解析备用代码失败:', e);
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
    console.error('2FA验证失败:', e);
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
    log('ERROR', '登出失败', { error: error.message });
    res.status(500).json({ error: '登出失败' });
  }
});

// 发送绑定邮箱验证码
router.post('/api/send-bind-code', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: "无效邮箱" });
  const token = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 600000;
  try {
    await getConnection().run('DELETE FROM reset_tokens WHERE email = ?', [email]);
    await getConnection().run('INSERT INTO reset_tokens (email, token, expires) VALUES (?, ?, ?)', 
      [email, token, expires]);
    await sendMail({
      to: email,
      subject: "绑定邮箱验证码",
      text: `您的验证码是 ${token}，10分钟内有效。`
    });
    res.json({ status: "ok" });
  } catch (e) {
    log('ERROR', '邮件发送失败', { error: e.message });
    res.status(500).json({ error: "验证码发送失败" });
  }
});

// 数据库操作重试函数
async function retryDbOperation(operation, maxRetries = 3, delay = 100) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (e) {
      if ((e.code === 'SQLITE_BUSY' || e.message?.includes('database is locked')) && i < maxRetries - 1) {
        log('WARN', '数据库繁忙,正在重试', { attempt: i + 1, error: e.message });
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

// 验证绑定邮箱
router.post('/api/verify-bind-email', emailVerifyRateLimit, async (req, res) => {
  const startTime = Date.now();
  try {
    const { email, token } = req.body;
    if (!req.user) {
      return res.status(401).json({ error: "会话已过期，请重新登录" });
    }

    if (!email || !token) {
      return res.status(400).json({ error: "邮箱和验证码不能为空" });
    }

    // 使用重试机制查询验证码
    const record = await retryDbOperation(async () => {
      return await getConnection().get('SELECT * FROM reset_tokens WHERE email = ? AND token = ?',
        [email, token]);
    });
    
    if (!record) {
      log('WARN', '验证码错误', { username: req.user, email, token });
      return res.status(400).json({ error: "验证码错误" });
    }

    if (record.expires < Date.now()) {
      return res.status(400).json({ error: "验证码已过期，请重新发送" });
    }

    // 使用事务和重试机制更新用户邮箱
    await retryDbOperation(async () => {
      const db = getConnection();
      await db.run('BEGIN TRANSACTION');
      try {
        // 更新用户邮箱
        await db.run('UPDATE users SET email = ? WHERE username = ?', [email, req.user]);

        // 成功后删除验证码
        await db.run('DELETE FROM reset_tokens WHERE email = ? AND token = ?', [email, token]);

        await db.run('COMMIT');
      } catch (e) {
        try {
          await db.run('ROLLBACK');
        } catch (rollbackError) {
          log('ERROR', '事务回滚失败', { error: rollbackError.message });
        }
        throw e;
      }
    });
    
    const duration = Date.now() - startTime;
    log('INFO', '用户绑定邮箱成功', { username: req.user, email, duration: `${duration}ms` });
    res.status(200).json({ status: "ok" });
  } catch (e) {
    const duration = Date.now() - startTime;
    log('ERROR', '验证并绑定邮箱异常', { username: req.user, error: e.message, stack: e.stack, duration: `${duration}ms` });
    if (!res.headersSent) {
      // 根据错误类型返回不同的错误信息
      if (e.code === 'SQLITE_BUSY' || e.message?.includes('database is locked')) {
        res.status(503).json({ error: "系统繁忙，请稍后再试" });
      } else {
        res.status(500).json({ error: "系统繁忙，请稍后再试" });
      }
    }
  }
});

// 忘记密码
router.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await getConnection().get('SELECT username FROM users WHERE email = ?', [email]);
  if (!user) return res.status(404).json({ error: "该邮箱未绑定账户" });
  const token = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 600000;
  try {
    await getConnection().run('DELETE FROM reset_tokens WHERE email = ?', [email]);
    await getConnection().run('INSERT INTO reset_tokens (email, token, expires) VALUES (?, ?, ?)', 
      [email, token, expires]);
    await sendMail({
      to: email,
      subject: "密码重置验证码",
      text: `验证码：${token}`
    });
    res.json({ status: "ok" });
  } catch (e) { res.status(500).json({ error: "发送失败" }); }
});

// 重置密码
router.post('/api/reset-password', async (req, res) => {
  const { email, token, newPass } = req.body;
  const record = await getConnection().get('SELECT * FROM reset_tokens WHERE email = ? AND token = ?', 
    [email, token]);
  if (!record || record.expires < Date.now()) {
    return res.status(400).json({ error: "验证码无效或已过期" });
  }
  
  if (!validatePassword(newPass)) {
    return res.status(400).json({ error: "密码长度至少需要6个字符" });
  }
  
  const hashedPassword = await bcrypt.hash(newPass, 10);
  await getConnection().run('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]);
  await getConnection().run('DELETE FROM reset_tokens WHERE email = ?', [email]);
  res.json({ status: "ok" });
});

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
    const user = await getConnection().get('SELECT * FROM users WHERE username = ?', [req.user]);
    
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
    await getConnection().run('UPDATE users SET password = ? WHERE username = ?', [hashedNewPassword, req.user]);
    await destroyUserSessions(req.user);

    const session = await createSession(req.user);
    res.cookie(config.cookieName, session.id, getSessionCookieOptions(req));
    
    log('INFO', '用户密码修改成功', { username: req.user });
    res.json({ status: "ok" });
  } catch (e) {
    log('ERROR', '密码修改失败', { username: req.user, error: e.message });
    res.status(500).json({ error: "密码修改失败，请稍后重试" });
  }
});

module.exports = router;
