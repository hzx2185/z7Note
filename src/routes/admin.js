const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const db = require('../db/client');
const { getUserFileSize } = require('../utils/helpers');
const { createBackupArchive } = require('../services/backup');
const { updateAllResources, getCDNBaseUrl, setCDNBaseUrl, getCDNStatus, clearCache } = require('../services/cdnProxy');
const { getAllSystemConfig, setMultipleSystemConfig, deleteSystemConfig, initDefaultConfig, getSmtpConfig, setSmtpConfig } = require('../services/systemConfig');
const { cleanupExpiredSessions } = require('../services/chunkUpload');
const { destroyUserSessions } = require('../services/session');
const config = require('../config');
const log = require('../utils/logger');
const { sanitizeInput, validateUsername, validateEmail, validatePassword } = require('../utils/validators');

const router = express.Router();

// 更新备份配置
router.post('/api/admin/backup/config', async (req, res) => {
  try {
    const { updateBackupConfig } = require('../services/backup');
    await updateBackupConfig(req.body);
    res.json({ status: "ok" });
  } catch (e) {
    console.error('[Admin] 保存备份配置失败:', e);
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

// 获取备份配置
router.get('/api/admin/backup/config', async (req, res) => { 
  res.json(await db.queryOne('SELECT * FROM backup_config WHERE id = 1') || {}); 
});

// 下载全量备份
router.get('/api/admin/backup/download-full', async (req, res) => { 
  const { filePath, fileName } = await createBackupArchive(false); 
  res.download(filePath, fileName); 
});

// 下载增量备份
router.get('/api/admin/backup/download-inc', async (req, res) => { 
  const { filePath, fileName } = await createBackupArchive(true); 
  res.download(filePath, fileName); 
});

// 获取备份列表
router.get('/api/admin/backup/list', async (req, res) => {
  const { getBackupList } = require('../services/backup');
  res.json(await getBackupList());
});

// 立即备份
router.post('/api/admin/backup/now', async (req, res) => {
  try {
    const { performBackup } = require('../services/backup');
    const backupConfig = await db.queryOne('SELECT * FROM backup_config WHERE id = 1') || {};
    if (!backupConfig.schedule) {
      return res.status(400).json({ error: '请先配置备份选项' });
    }
    await performBackup(backupConfig);
    res.json({ status: 'ok', message: '备份已执行' });
  } catch (e) {
    console.error('[Admin] 立即备份失败:', e);
    res.status(500).json({ error: '备份失败: ' + e.message });
  }
});

// 获取用户统计
router.get('/api/admin/users/stats', async (req, res) => {
  try {
    const { search, sort, order } = req.query;
    let users = await db.queryAll('SELECT username, email, noteLimit, fileLimit FROM users');
    
    let stats = await Promise.all(users.map(async (u) => {
      const username = (u.username || '').trim();
      // 并行执行所有统计，包括数量和空间
      const [n, c, e, t] = await Promise.all([
        db.queryOne('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(title) + LENGTH(content)), 0) as sz FROM notes WHERE LOWER(username) = LOWER(?) AND deleted = 0', [username]),
        db.queryOne('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(fn) + LENGTH(vcard)), 0) as sz FROM contacts WHERE LOWER(username) = LOWER(?)', [username]),
        db.queryOne('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(title) + LENGTH(description)), 0) as sz FROM events WHERE LOWER(username) = LOWER(?)', [username]),
        db.queryOne('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(title) + LENGTH(description)), 0) as sz FROM todos WHERE LOWER(username) = LOWER(?)', [username])
      ]);

      const attachmentSize = await getUserFileSize(username);
      
      return { 
        ...u, 
        noteCount: n?.cnt || 0,
        contactCount: c?.cnt || 0,
        eventCount: e?.cnt || 0,
        todoCount: t?.cnt || 0,
        dbSize: (n?.sz || 0) + (c?.sz || 0) + (e?.sz || 0) + (t?.sz || 0),
        attachmentSize: attachmentSize || 0
      };
    }));

    if (search) {
      const s = search.toLowerCase();
      stats = stats.filter(u => 
        u.username.toLowerCase().includes(s) || 
        (u.email && u.email.toLowerCase().includes(s))
      );
    }
    
    if (sort) {
      stats.sort((a, b) => {
        let valA = a[sort], valB = b[sort];
        if (typeof valA === 'string') return order === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return order === 'asc' ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
      });
    }
    res.json(stats);
  } catch (e) { 
    console.error('[Admin] 获取用户统计失败:', e);
    res.status(500).json({ error: "Stats failed" }); 
  }
});

// 删除用户
router.delete('/api/admin/users/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const user = await db.queryOne('SELECT username, email FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(404).json({ error: "用户不存在" });
    }

    const userUploadDir = path.join(config.paths.uploads, username);
    await db.withTransaction(async (tx) => {
      await tx.execute('DELETE FROM contact_history WHERE username = ?', [username]);
      await tx.execute('DELETE FROM contacts WHERE username = ?', [username]);
      await tx.execute('DELETE FROM calendar_subscriptions WHERE username = ?', [username]);
      await tx.execute('DELETE FROM reminder_history WHERE username = ?', [username]);
      await tx.execute('DELETE FROM reminder_settings WHERE username = ?', [username]);
      await tx.execute('DELETE FROM deleted_items WHERE username = ?', [username]);
      await tx.execute('DELETE FROM events WHERE username = ?', [username]);
      await tx.execute('DELETE FROM todos WHERE username = ?', [username]);
      await tx.execute('DELETE FROM notes WHERE username = ?', [username]);
      await tx.execute('DELETE FROM shares WHERE owner = ?', [username]);
      await tx.execute('DELETE FROM upload_chunks WHERE username = ?', [username]);
      await tx.execute('DELETE FROM user_backup_config WHERE username = ?', [username]);
      await tx.execute('DELETE FROM user_sessions WHERE username = ?', [username]);
      if (user.email) {
        await tx.execute('DELETE FROM reset_tokens WHERE email = ?', [user.email]);
      }
      await tx.execute('DELETE FROM users WHERE username = ?', [username]);
    });
    try {
      await fs.rm(userUploadDir, { recursive: true, force: true });
    } catch (e) {
      // 用户目录不存在或删除失败，忽略
    }
    log('INFO', '管理员删除用户', { username, deletedBy: req.user });
    res.json({ status: "ok" });
  } catch (e) {
    res.status(500).json({ error: "删除失败" }); 
  }
});

// 重置用户密码
router.post('/api/admin/users/reset-password', async (req, res) => {
  const { username, newPassword } = req.body;
  const result = await db.execute('UPDATE users SET password = ? WHERE username = ?', 
    [await bcrypt.hash(newPassword, 10), username]);
  if (!result.changes) {
    return res.status(404).json({ error: "用户不存在" });
  }
  await destroyUserSessions(username);
  log('INFO', '管理员重置用户密码', { username, resetBy: req.user });
  res.json({ status: "ok" });
});

// 更新用户配额
router.post('/api/admin/users/update-quota', async (req, res) => {
  const { username, noteLimit, fileLimit } = req.body;
  try { 
    await db.execute('UPDATE users SET noteLimit = ?, fileLimit = ? WHERE username = ?', 
      [noteLimit, fileLimit, username]); 
    log('INFO', '管理员更新用户配额', { username, noteLimit, fileLimit, updatedBy: req.user });
    res.json({ status: "ok" }); 
  } catch (e) { res.status(500).json({ error: "Update failed" }); }
});

// 添加用户
router.post('/api/admin/users/add', async (req, res) => {
  const { username, password, email } = req.body;
  try { 
    const sanitizedUsername = sanitizeInput(username, 20);
    const normalizedEmail = sanitizeInput(email, 255).toLowerCase();
    const sanitizedPassword = sanitizeInput(password, 100);

    if (!validateUsername(sanitizedUsername)) {
      return res.status(400).json({ error: "用户名必须是3-20个字符，只允许字母、数字、下划线" });
    }
    if (!validateEmail(normalizedEmail)) {
      return res.status(400).json({ error: "邮箱格式不正确" });
    }
    if (!validatePassword(sanitizedPassword)) {
      return res.status(400).json({ error: "密码至少需要6个字符" });
    }

    const existingEmailUser = await db.queryOne(
      'SELECT username FROM users WHERE LOWER(email) = LOWER(?)',
      [normalizedEmail]
    );
    if (existingEmailUser) {
      return res.status(400).json({ error: "邮箱已被其他账户绑定" });
    }

    await db.execute('INSERT INTO users (username, password, email) VALUES (?, ?, ?)', 
      [sanitizedUsername, await bcrypt.hash(sanitizedPassword, 10), normalizedEmail]); 
    log('INFO', '管理员添加用户', { username: sanitizedUsername, email: normalizedEmail, addedBy: req.user });
    res.json({ status: "ok" }); 
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: "用户名已存在" });
    }
    res.status(400).json({ error: "新增用户失败" });
  }
});

// 清理已删除笔记
router.post('/api/admin/notes/purge', async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const deletedNotes = await db.queryAll('SELECT DISTINCT username FROM notes WHERE deleted = 1');
    for (const user of deletedNotes) {
      await db.execute('UPDATE users SET dataCutoffTime = ? WHERE username = ?', [now, user.username]);
    }
    await db.execute('DELETE FROM notes WHERE deleted = 1');
    await db.maintenance.compact();
    log('INFO', '管理员清理已删除笔记', { purgedBy: req.user, cutoff: now });
    res.json({ status: "ok", message: `已清理并设置拦截点：${new Date(now).toLocaleString()}` });
  } catch (e) { res.status(500).json({ error: "物理清理失败" }); }
});

// 获取所有笔记
router.get('/api/admin/notes/all', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const search = req.query.search || '';
  const offset = (page - 1) * limit;
  let whereClause = '', params = [];
  if (search) { whereClause = ' WHERE username LIKE ? OR title LIKE ?'; params = [`%${search}%`, `%${search}%`]; }
  const countRes = await db.queryOne(`SELECT COUNT(*) as total FROM notes ${whereClause}`, params);
  const notes = await db.queryAll(
    `SELECT * FROM notes ${whereClause} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`, 
    [...params, limit, offset]
  );
  res.json({ total: countRes.total, page, totalPages: Math.ceil(countRes.total / limit), notes });
});

// 删除笔记
router.delete('/api/admin/notes/:id', async (req, res) => {
  await db.execute('DELETE FROM notes WHERE id = ?', [req.params.id]);
  log('INFO', '管理员删除笔记', { noteId: req.params.id, deletedBy: req.user });
  res.json({ status: "ok" });
});

// 更新 CDN 缓存
router.post('/api/admin/cdn/update', async (req, res) => {
  try {
    const result = await updateAllResources();
    log('INFO', '管理员更新 CDN 缓存', { updatedBy: req.user, result });
    res.json({ status: "ok", ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取 CDN 配置
router.get('/api/admin/cdn/config', async (req, res) => {
  try {
    const baseUrl = getCDNBaseUrl();
    res.json({ status: "ok", baseUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新 CDN 配置
router.post('/api/admin/cdn/config', async (req, res) => {
  try {
    const { baseUrl } = req.body;
    if (!baseUrl) {
      return res.status(400).json({ error: "baseUrl 不能为空" });
    }
    setCDNBaseUrl(baseUrl);
    log('INFO', '管理员修改 CDN 配置', { updatedBy: req.user, baseUrl });
    res.json({ status: "ok", baseUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取 CDN 状态
router.get('/api/admin/cdn/status', async (req, res) => {
  try {
    const status = await getCDNStatus();
    res.json({ status: "ok", resources: status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 清理 CDN 缓存
router.post('/api/admin/cdn/clear', async (req, res) => {
  try {
    const result = await clearCache();
    log('INFO', '管理员清理 CDN 缓存', { updatedBy: req.user, result });
    res.json({ status: "ok", ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取 SMTP 配置
router.get('/api/admin/smtp/config', async (req, res) => {
  try {
    const config = await getSmtpConfig();
    res.json({ status: "ok", config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新 SMTP 配置
router.post('/api/admin/smtp/config', async (req, res) => {
  try {
    const { host, port, secure, user, pass } = req.body;
    
    await setSmtpConfig({ host, port, secure, user, pass });
    log('INFO', '管理员修改 SMTP 配置', { updatedBy: req.user, host, port, user });
    res.json({ status: "ok", message: 'SMTP 配置已更新' });
  } catch (e) {
    console.error('[Admin] 保存 SMTP 配置失败:', e);
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

// 测试 SMTP 配置
router.post('/api/admin/smtp/test', async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) {
      return res.status(400).json({ error: '请提供测试邮箱地址' });
    }

    const { sendMail } = require('../services/mailer');
    await sendMail({
      to,
      subject: 'z7Note SMTP 配置测试',
      text: '这是一封测试邮件，如果您收到此邮件，说明 SMTP 配置正确。',
      html: '<p>这是一封测试邮件，如果您收到此邮件，说明 SMTP 配置正确。</p>'
    });

    log('INFO', '管理员测试 SMTP 配置', { updatedBy: req.user, to });
    res.json({ status: "ok", message: '测试邮件已发送' });
  } catch (e) {
    console.error('[Admin] SMTP 测试失败:', e);
    res.status(500).json({ error: '测试失败: ' + e.message });
  }
});

// 获取系统配置
router.get('/api/admin/system/config', async (req, res) => {
  try {
    const config = await getAllSystemConfig();
    res.json({ status: "ok", config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新系统配置
router.post('/api/admin/system/config', async (req, res) => {
  try {
    const { configs } = req.body;
    if (!configs || typeof configs !== 'object') {
      return res.status(400).json({ error: "无效的配置数据" });
    }

    await setMultipleSystemConfig(configs);
    log('INFO', '管理员修改系统配置', { updatedBy: req.user, configs });
    res.json({ status: "ok" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 恢复默认配置
router.post('/api/admin/system/config/reset', async (req, res) => {
  try {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys)) {
      return res.status(400).json({ error: "无效的key数组" });
    }

    for (const key of keys) {
      await deleteSystemConfig(key);
    }

    log('INFO', '管理员重置系统配置', { resetBy: req.user, keys });
    res.json({ status: "ok" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 清理过期的上传会话
router.post('/api/admin/system/cleanup-uploads', async (req, res) => {
  try {
    const count = await cleanupExpiredSessions();
    log('INFO', '管理员清理过期上传会话', { cleanedBy: req.user, count });
    res.json({ status: "ok", count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 初始化默认配置
router.post('/api/admin/system/init-defaults', async (req, res) => {
  try {
    await initDefaultConfig();
    log('INFO', '初始化默认系统配置', { initializedBy: req.user });
    res.json({ status: "ok", message: "默认配置已初始化" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 清空所有用户的回收站
router.delete('/api/admin/trash/empty-all', async (req, res) => {
  try {
    const result = await db.execute(
      'DELETE FROM notes WHERE deleted = 1'
    );
    log('INFO', '清空所有回收站', { count: result.changes });
    res.json({ status: 'ok', count: result.changes });
  } catch (e) {
    log('ERROR', '清空所有回收站失败', { error: e.message });
    res.status(500).json({ error: '清空失败' });
  }
});

  // 获取数据库空间信息
  router.get('/api/admin/database/info', async (req, res) => {
    try {
      const dbPath = config.paths.database;
      const dbStats = await fs.stat(dbPath);
      const dbSizeBytes = dbStats.size;
      const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);

      const storageStats = await db.maintenance.getStorageStats();
      const totalPages = storageStats.pageCount || 0;
      const pageSize = storageStats.pageSize || 4096;
      const freePages = storageStats.freelistCount || 0;
      const freeBytes = freePages * pageSize;
      const freeMB = (freeBytes / (1024 * 1024)).toFixed(2);
      const usedMB = (dbSizeMB - freeMB).toFixed(2);

      res.json({
        totalSizeMB: dbSizeMB,
        usedSizeMB: usedMB,
        freeSpaceMB: freeMB,
        totalPages,
        freePages,
        pageSize
      });
    } catch (e) {
      log('ERROR', '获取数据库信息失败', { error: e.message });
      res.status(500).json({ error: '获取数据库信息失败' });
    }
  });

  // 执行数据库VACUUM清理
  router.post('/api/admin/database/vacuum', async (req, res) => {
    try {
      log('INFO', '开始执行数据库VACUUM');

      // 执行VACUUM操作
      await db.maintenance.compact();

      log('INFO', '数据库VACUUM完成');
      res.json({ status: 'ok', message: '数据库清理完成' });
    } catch (e) {
      log('ERROR', '数据库VACUUM失败', { error: e.message });
      res.status(500).json({ error: '数据库清理失败: ' + e.message });
    }
  });

  module.exports = router;
