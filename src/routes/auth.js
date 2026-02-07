const express = require('express');
const bcrypt = require('bcrypt');
const { getConnection } = require('../db/connection');
const config = require('../config');
const { sanitizeInput, validateUsername, validateEmail, validatePassword } = require('../utils/validators');
const { sendMail } = require('../services/mailer');
const { genToken } = require('../utils/helpers');
const log = require('../utils/logger');

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
    res.cookie(config.cookieName, sanitizedUser, { 
      maxAge: config.cookieMaxAge, 
      httpOnly: true, 
      path: '/', 
      sameSite: 'lax' 
    });
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
      res.cookie(config.cookieName, row.username, { 
        maxAge: config.cookieMaxAge, 
        httpOnly: true, 
        path: '/', 
        sameSite: 'lax' 
      });
      return res.json({ status: "ok" });
    }
    res.status(403).json({ error: "账号或密码错误" });
  } catch (e) {
    console.error('登录失败:', e);
    res.status(500).json({ error: "服务器内部错误" });
  }
});

// 登出
router.post('/api/logout', (req, res) => { 
  res.clearCookie(config.cookieName); 
  res.json({ status: "ok" }); 
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

// 验证绑定邮箱
router.post('/api/verify-bind-email', async (req, res) => {
  const { email, token } = req.body;
  const record = await getConnection().get('SELECT * FROM reset_tokens WHERE email = ? AND token = ?', 
    [email, token]);
  if (!record || record.expires < Date.now()) {
    return res.status(400).json({ error: "验证码错误或已过期" });
  }
  await getConnection().run('UPDATE users SET email = ? WHERE username = ?', [email, req.user]);
  await getConnection().run('DELETE FROM reset_tokens WHERE email = ?', [email]);
  res.json({ status: "ok" });
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

module.exports = router;
