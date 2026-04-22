const express = require('express');
const db = require('../../db/client');
const { validateEmail, validatePassword } = require('../../utils/validators');
const { sendMail } = require('../../services/mailer');
const {
  normalizeEmail,
  getUsersByEmail,
  createResetToken,
  getResetTokenRecord,
  updateUserPassword
} = require('../../services/authAccount');
const log = require('../../utils/logger');
const { AUTH_EVENTS } = require('../../constants/securityEvents');
const {
  passwordResetRequestRateLimit,
  passwordResetConfirmRateLimit
} = require('../../middleware/rateLimit');
const { destroyUserSessions } = require('../../services/session');

const router = express.Router();

router.post('/api/forgot-password', passwordResetRequestRateLimit, async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body.email);
  if (!validateEmail(normalizedEmail)) {
    return res.status(400).json({ error: "无效邮箱" });
  }

  try {
    const users = await getUsersByEmail(normalizedEmail);

    if (users.length === 1) {
      const resetToken = await createResetToken(normalizedEmail);
      await sendMail({
        to: normalizedEmail,
        subject: "密码重置验证码",
        text: `验证码：${resetToken.token}`
      });
    } else {
      log('WARN', '找回密码请求未发送邮件', {
        event: AUTH_EVENTS.PASSWORD_RESET_REQUEST_SKIPPED,
        email: normalizedEmail,
        matchedUsers: users.length
      });
    }

    res.json({ status: "ok" });
  } catch (e) {
    res.status(500).json({ error: "发送失败" });
  }
});

router.post('/api/reset-password', passwordResetConfirmRateLimit, async (req, res) => {
  const { email, token, newPass } = req.body;
  const normalizedEmail = normalizeEmail(email);
  const record = await getResetTokenRecord(normalizedEmail, token);
  if (!record || record.expires < Date.now()) {
    return res.status(400).json({ error: "验证码无效或已过期" });
  }

  if (!validatePassword(newPass)) {
    return res.status(400).json({ error: "密码长度至少需要6个字符" });
  }

  const users = await getUsersByEmail(normalizedEmail);
  if (users.length === 0) {
    await db.execute('DELETE FROM reset_tokens WHERE email = ?', [normalizedEmail]);
    return res.status(404).json({ error: "该邮箱未绑定账户" });
  }
  if (users.length > 1) {
    return res.status(409).json({ error: "该邮箱绑定了多个账户，请联系管理员处理" });
  }

  await updateUserPassword(users[0].username, newPass);
  await destroyUserSessions(users[0].username);
  await db.execute('DELETE FROM reset_tokens WHERE email = ?', [normalizedEmail]);
  res.json({ status: "ok" });
});

module.exports = router;
