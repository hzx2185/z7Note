const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const { getConnection } = require('../db/connection');
const { getUserFileSize } = require('../utils/helpers');
const { createBackupArchive } = require('../services/backup');
const { updateAllResources, getCDNBaseUrl, setCDNBaseUrl } = require('../services/cdnProxy');
const { getAllSystemConfig, setMultipleSystemConfig, deleteSystemConfig, initDefaultConfig } = require('../services/systemConfig');
const { cleanupExpiredSessions } = require('../services/chunkUpload');
const config = require('../config');
const log = require('../utils/logger');

const router = express.Router();

// 更新备份配置
router.post('/api/admin/backup/config', async (req, res) => {
  try {
    const c = req.body;
    const keepCount = parseInt(c.keepCount) || 0;
    await getConnection().run(
      `INSERT INTO backup_config (id, schedule, includeAttachments, backupMode, sendEmail, emailAddress, useWebDAV, webdavUrl, webdavUser, webdavPassword, keepCount)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      schedule=excluded.schedule, includeAttachments=excluded.includeAttachments, backupMode=excluded.backupMode,
      sendEmail=excluded.sendEmail, emailAddress=excluded.emailAddress, useWebDAV=excluded.useWebDAV,
      webdavUrl=excluded.webdavUrl, webdavUser=excluded.webdavUser, webdavPassword=excluded.webdavPassword,
      keepCount=excluded.keepCount`,
      [c.schedule, c.includeAttachments?1:0, c.backupMode, c.sendEmail?1:0, c.emailAddress,
       c.useWebDAV?1:0, c.webdavUrl, c.webdavUser, c.webdavPassword, keepCount]
    );
    const newConfig = await getConnection().get('SELECT * FROM backup_config WHERE id = 1');
    const { setupCron } = require('../services/backup');
    setupCron(newConfig);
    res.json({ status: "ok" });
  } catch (e) {
    console.error('[Admin] 保存备份配置失败:', e);
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

// 获取备份配置
router.get('/api/admin/backup/config', async (req, res) => { 
  res.json(await getConnection().get('SELECT * FROM backup_config WHERE id = 1') || {}); 
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
    const backupConfig = await getConnection().get('SELECT * FROM backup_config WHERE id = 1') || {};
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
    let users = await getConnection().all('SELECT username, email, noteLimit, fileLimit FROM users');
    
    let stats = await Promise.all(users.map(async (u) => {
      const noteData = await getConnection().get(
        'SELECT COUNT(*) as count, SUM(LENGTH(content)) as size FROM notes WHERE username = ? AND deleted = 0', 
        [u.username]
      );
      const attachmentSize = await getUserFileSize(u.username);
      let attachmentCount = 0;
      try {
        const files = await fs.readdir(path.join(config.paths.uploads, u.username));
        attachmentCount = files.length;
      } catch(e) {
        // 用户目录不存在时附件数为0
      }
      return { ...u, noteCount: noteData.count || 0, noteSize: noteData.size || 0, attachmentSize, attachmentCount };
    }));

    if (search) stats = stats.filter(u => u.username.includes(search) || (u.email && u.email.includes(search)));
    if (sort) {
      stats.sort((a, b) => {
        let valA = a[sort], valB = b[sort];
        if (sort === 'username') return order === 'asc' ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
        return order === 'asc' ? valA - valB : valB - valA;
      });
    }
    res.json(stats);
  } catch (e) { res.status(500).json({ error: "Stats failed" }); }
});

// 删除用户
router.delete('/api/admin/users/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const userUploadDir = path.join(config.paths.uploads, username);
    await getConnection().run('BEGIN TRANSACTION');
    await getConnection().run('DELETE FROM notes WHERE username = ?', [username]);
    await getConnection().run('DELETE FROM users WHERE username = ?', [username]);
    await getConnection().run('COMMIT');
    try {
      await fs.rm(userUploadDir, { recursive: true, force: true });
    } catch (e) {
      // 用户目录不存在或删除失败，忽略
    }
    log('INFO', '管理员删除用户', { username, deletedBy: req.user });
    res.json({ status: "ok" });
  } catch (e) { 
    await getConnection().run('ROLLBACK'); 
    res.status(500).json({ error: "删除失败" }); 
  }
});

// 重置用户密码
router.post('/api/admin/users/reset-password', async (req, res) => {
  const { username, newPassword } = req.body;
  await getConnection().run('UPDATE users SET password = ? WHERE username = ?', 
    [await bcrypt.hash(newPassword, 10), username]);
  log('INFO', '管理员重置用户密码', { username, resetBy: req.user });
  res.json({ status: "ok" });
});

// 更新用户配额
router.post('/api/admin/users/update-quota', async (req, res) => {
  const { username, noteLimit, fileLimit } = req.body;
  try { 
    await getConnection().run('UPDATE users SET noteLimit = ?, fileLimit = ? WHERE username = ?', 
      [noteLimit, fileLimit, username]); 
    log('INFO', '管理员更新用户配额', { username, noteLimit, fileLimit, updatedBy: req.user });
    res.json({ status: "ok" }); 
  } catch (e) { res.status(500).json({ error: "Update failed" }); }
});

// 添加用户
router.post('/api/admin/users/add', async (req, res) => {
  const { username, password, email } = req.body;
  try { 
    await getConnection().run('INSERT INTO users (username, password, email) VALUES (?, ?, ?)', 
      [username, await bcrypt.hash(password, 10), email]); 
    log('INFO', '管理员添加用户', { username, email, addedBy: req.user });
    res.json({ status: "ok" }); 
  } catch (e) { res.status(400).json({ error: "用户已存在" }); }
});

// 清理已删除笔记
router.post('/api/admin/notes/purge', async (req, res) => {
  try {
    const now = Date.now();
    const deletedNotes = await getConnection().all('SELECT DISTINCT username FROM notes WHERE deleted = 1');
    for (const user of deletedNotes) {
      await getConnection().run('UPDATE users SET dataCutoffTime = ? WHERE username = ?', [now, user.username]);
    }
    await getConnection().run('DELETE FROM notes WHERE deleted = 1');
    await getConnection().run('VACUUM');
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
  const countRes = await getConnection().get(`SELECT COUNT(*) as total FROM notes ${whereClause}`, params);
  const notes = await getConnection().all(
    `SELECT * FROM notes ${whereClause} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`, 
    [...params, limit, offset]
  );
  res.json({ total: countRes.total, page, totalPages: Math.ceil(countRes.total / limit), notes });
});

// 删除笔记
router.delete('/api/admin/notes/:id', async (req, res) => {
  await getConnection().run('DELETE FROM notes WHERE id = ?', [req.params.id]);
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
    const result = await getConnection().run(
      'DELETE FROM notes WHERE deleted = 1'
    );
    log('INFO', '清空所有回收站', { count: result.changes });
    res.json({ status: 'ok', count: result.changes });
  } catch (e) {
    log('ERROR', '清空所有回收站失败', { error: e.message });
    res.status(500).json({ error: '清空失败' });
  }
});

module.exports = router;
