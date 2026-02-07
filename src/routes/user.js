const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');

const router = express.Router();

// 获取用户博客配置
router.get('/api/user/blog-config/:username', async (req, res) => {
  try {
    const user = await getConnection().get(
      'SELECT username, blogTitle, blogSubtitle, blogTheme, blogShowHeader, blogShowFooter, customCSS FROM users WHERE username = ?', 
      [req.params.username]
    );
    if (!user) return res.status(404).json({ error: "用户不存在" });
    res.json(user);
  } catch (e) { res.status(500).json({ error: "获取失败" }); }
});

// 更新用户博客配置
router.post('/api/user/blog-config', async (req, res) => {
  try {
    const { blogTitle, blogSubtitle, blogTheme, blogShowHeader, blogShowFooter, customCSS } = req.body;
    await getConnection().run(
      `UPDATE users SET blogTitle = ?, blogSubtitle = ?, blogTheme = ?, blogShowHeader = ?, blogShowFooter = ?, customCSS = ? WHERE username = ?`,
      [blogTitle || null, blogSubtitle || null, blogTheme || 'light', blogShowHeader ? 1 : 0, 
       blogShowFooter ? 1 : 0, customCSS || null, req.user]
    );
    res.json({ status: "ok" });
  } catch (e) { console.error('Update blog config error:', e); res.status(500).json({ error: "更新失败" }); }
});

// 更新用户编辑器类型
router.post('/api/user/editor-type', async (req, res) => {
  try {
    const { editorType } = req.body;
    if (!['codemirror', 'textarea'].includes(editorType)) return res.status(400).json({ error: "无效的编辑器类型" });
    await getConnection().run('UPDATE users SET editorType = ? WHERE username = ?', [editorType, req.user]);
    res.json({ status: "ok" });
  } catch (e) { console.error('Update editor type error:', e); res.status(500).json({ error: "更新失败" }); }
});

// 导出用户数据
router.get('/api/export', async (req, res) => {
  try {
    const notes = await getConnection().all('SELECT * FROM notes WHERE username = ?', [req.user]);
    const userDir = path.join(process.cwd(), 'data', 'uploads', req.user);
    let attachments = [];
    try {
      const files = await fs.readdir(userDir);
      for (const file of files) {
        const filePath = path.join(userDir, file);
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          if (stat.size <= 10 * 1024 * 1024) {
            attachments.push({ 
              name: file, 
              content: (await fs.readFile(filePath)).toString('base64'), 
              size: stat.size, 
              mtime: stat.mtime 
            });
          } else {
            attachments.push({ 
              name: file, 
              content: null, 
              size: stat.size, 
              mtime: stat.mtime, 
              skipped: true, 
              reason: '文件过大' 
            });
          }
        }
      }
    } catch (e) { console.error('读取附件目录失败:', e); }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="z7note-export-${Date.now()}.json"`);
    res.json({ version: 1, exportedAt: new Date().toISOString(), username: req.user, notes, attachments });
  } catch (e) { console.error('Export error:', e); res.status(500).json({ error: "导出失败" }); }
});

// 导入用户数据
router.post('/api/import', async (req, res) => {
  try {
    const { notes, attachments } = req.body;
    if (notes && Array.isArray(notes)) {
      for (const note of notes) {
        if (note.username === req.user) {
          await getConnection().run(
            `INSERT INTO notes (id, username, title, content, updatedAt, deleted) VALUES (?, ?, ?, ?, ?, ?) 
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, 
             updatedAt=excluded.updatedAt, deleted=excluded.deleted`,
            [note.id, req.user, note.title, note.content, note.updatedAt, note.deleted || 0]
          );
        }
      }
    }
    if (attachments && Array.isArray(attachments)) {
      const userDir = path.join(process.cwd(), 'data', 'uploads', req.user);
      await fs.mkdir(userDir, { recursive: true });
      for (const att of attachments) {
        try { 
          await fs.writeFile(path.join(userDir, att.name), Buffer.from(att.content, 'base64')); 
        } catch (e) { console.error('Failed to import attachment:', att.name, e); }
      }
    }
    log('INFO', '用户导入数据', { username: req.user, notesCount: notes?.length || 0, attachmentsCount: attachments?.length || 0 });
    res.json({ status: "ok", message: `导入完成 ${notes?.length || 0} 条笔记, ${attachments?.length || 0} 个附件` });
  } catch (e) { console.error('Import error:', e); res.status(500).json({ error: "导入失败" }); }
});

module.exports = router;
