const express = require('express');
const db = require('../../db/client');
const { validateEmail } = require('../../utils/validators');
const { sendMail } = require('../../services/mailer');
const {
  normalizeEmail,
  getResetTokenRecord,
  retryBusyOperation
} = require('../../services/authAccount');
const log = require('../../utils/logger');
const { AUTH_EVENTS } = require('../../constants/securityEvents');
const {
  emailVerifyRateLimit,
  bindEmailSendRateLimit
} = require('../../middleware/rateLimit');

const router = express.Router();

function logBusyRetry(error, attempt) {
  log('WARN', '数据库繁忙,正在重试', {
    event: AUTH_EVENTS.DB_RETRY,
    attempt,
    error: error.message
  });
}

router.post('/api/send-bind-code', bindEmailSendRateLimit, async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = normalizeEmail(email);
  if (!req.user) return res.status(401).json({ error: "会话已过期，请重新登录" });
  if (!validateEmail(normalizedEmail)) return res.status(400).json({ error: "无效邮箱" });

  const token = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 600000;

  try {
    const existingUser = await db.queryOne(
      'SELECT username FROM users WHERE LOWER(email) = LOWER(?) AND username != ?',
      [normalizedEmail, req.user]
    );
    if (existingUser) {
      return res.status(409).json({ error: "该邮箱已被其他账户绑定" });
    }

    await db.execute('DELETE FROM reset_tokens WHERE email = ?', [normalizedEmail]);
    await db.execute(
      'INSERT INTO reset_tokens (email, token, expires) VALUES (?, ?, ?)',
      [normalizedEmail, token, expires]
    );
    await sendMail({
      to: normalizedEmail,
      subject: "绑定邮箱验证码",
      text: `您的验证码是 ${token}，10分钟内有效。`
    });
    res.json({ status: "ok" });
  } catch (e) {
    log('ERROR', '邮件发送失败', {
      event: AUTH_EVENTS.BIND_CODE_SEND_FAILED,
      error: e.message
    });
    res.status(500).json({ error: "验证码发送失败" });
  }
});

router.post('/api/verify-bind-email', emailVerifyRateLimit, async (req, res) => {
  const startTime = Date.now();
  try {
    const { email, token } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!req.user) {
      return res.status(401).json({ error: "会话已过期，请重新登录" });
    }

    if (!normalizedEmail || !token) {
      return res.status(400).json({ error: "邮箱和验证码不能为空" });
    }
    if (!validateEmail(normalizedEmail)) {
      return res.status(400).json({ error: "邮箱格式不正确" });
    }

    const record = await retryBusyOperation(
      () => getResetTokenRecord(normalizedEmail, token),
      { onRetry: logBusyRetry }
    );

    if (!record) {
      log('WARN', '验证码错误', {
        event: AUTH_EVENTS.BIND_EMAIL_TOKEN_INVALID,
        username: req.user,
        email: normalizedEmail
      });
      return res.status(400).json({ error: "验证码错误" });
    }

    if (record.expires < Date.now()) {
      return res.status(400).json({ error: "验证码已过期，请重新发送" });
    }

    await retryBusyOperation(
      async () => {
        await db.withTransaction(async (tx) => {
          const existingUser = await tx.queryOne(
            'SELECT username FROM users WHERE LOWER(email) = LOWER(?) AND username != ?',
            [normalizedEmail, req.user]
          );
          if (existingUser) {
            throw new Error('EMAIL_ALREADY_BOUND');
          }

          await tx.execute('UPDATE users SET email = ? WHERE username = ?', [normalizedEmail, req.user]);
          await tx.execute('DELETE FROM reset_tokens WHERE email = ? AND token = ?', [normalizedEmail, token]);
        });
      },
      { onRetry: logBusyRetry }
    );

    const duration = Date.now() - startTime;
    log('INFO', '用户绑定邮箱成功', { username: req.user, email: normalizedEmail, duration: `${duration}ms` });
    res.status(200).json({ status: "ok" });
  } catch (e) {
    const duration = Date.now() - startTime;
    log('ERROR', '验证并绑定邮箱异常', {
      event: AUTH_EVENTS.BIND_EMAIL_FAILED,
      username: req.user,
      error: e.message,
      stack: e.stack,
      duration: `${duration}ms`
    });
    if (!res.headersSent) {
      if (e.message === 'EMAIL_ALREADY_BOUND') {
        res.status(409).json({ error: "该邮箱已被其他账户绑定" });
      } else if (e.code === 'SQLITE_BUSY' || e.message?.includes('database is locked')) {
        res.status(503).json({ error: "系统繁忙，请稍后再试" });
      } else {
        res.status(500).json({ error: "系统繁忙，请稍后再试" });
      }
    }
  }
});

module.exports = router;
