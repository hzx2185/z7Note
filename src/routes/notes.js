const express = require('express');
const { getConnection } = require('../db/connection');
const { getUserFileSize } = require('../utils/helpers');
const log = require('../utils/logger');
const { broadcastNoteUpdate, broadcastNoteDelete, broadcastNotesUpdate } = require('./sse');
const { broadcastNoteUpdate: wsBroadcastNoteUpdate, broadcastNoteDelete: wsBroadcastNoteDelete } = require('./ws');
const { getSystemConfig } = require('../services/systemConfig');
const config = require('../config');

const router = express.Router();

// 辅助：清洗标题，移除控制字符以防止文件名冲突
function sanitizeTitle(title) {
  if (!title) return title;
  // 移除 0-31 和 127 之间的控制字符（包括 \v, \n, \r 等）
  // 但保留 \n \r \t 可能在某些情况下有用，虽然作为标题通常不需要
  // Windows 不允许: \ / : * ? " < > |
  // 我们主要移除不可见的控制字符
  return title.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
}

// 获取用户信息
router.get('/api/user-info', async (req, res) => {
  try {
    const db = getConnection();
    const username = req.user;
    const user = await db.get(
      'SELECT username, email, noteLimit, fileLimit, blogTitle, blogSubtitle, blogTheme, blogShowHeader, blogShowFooter, customCSS, editorType FROM users WHERE username = ?',
      [username]
    );
    if (!user) return res.status(404).json({ error: "用户不存在" });

    // 并行获取所有数据的数量和空间占用
    const [n, c, e, t] = await Promise.all([
      db.get('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(title) + LENGTH(content)), 0) as sz FROM notes WHERE LOWER(username) = LOWER(?) AND deleted = 0', [username]),
      db.get('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(fn) + LENGTH(vcard)), 0) as sz FROM contacts WHERE LOWER(username) = LOWER(?)', [username]),
      db.get('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(title) + LENGTH(description)), 0) as sz FROM events WHERE LOWER(username) = LOWER(?)', [username]),
      db.get('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(title) + LENGTH(description)), 0) as sz FROM todos WHERE LOWER(username) = LOWER(?)', [username])
    ]);

    // 计算总数据库占用 (MB)
    const userDbSizeBytes = (n?.sz || 0) + (c?.sz || 0) + (e?.sz || 0) + (t?.sz || 0);
    const userDbSizeMB = (userDbSizeBytes / (1024 * 1024)).toFixed(2);

    const fileSizeBytes = await getUserFileSize(username);
    const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);

    const isAdmin = config.adminUsers.includes(username);

    // 获取数据库文件总大小
    const fs = require('fs').promises;
    const dbPath = config.paths.database;
    let totalDbSizeMB = '0.00';
    let dbFreeSpaceMB = '0.00';

    try {
      const dbStats = await fs.stat(dbPath);
      totalDbSizeMB = (dbStats.size / (1024 * 1024)).toFixed(2);

      // 获取数据库空闲空间
      const freelistResult = await db.get('PRAGMA freelist_count');
      const freeBytes = (freelistResult.freelist_count || 0) * 4096;
      dbFreeSpaceMB = (freeBytes / (1024 * 1024)).toFixed(2);
    } catch (err) {
      log.error('获取数据库大小失败:', err);
    }

    // 获取附件预览配置
    const attachmentPreviewConfig = {
      pdfMaxSize: parseInt(await getSystemConfig('pdfMaxSize')) || config.attachmentPreview.pdfMaxSize,
      videoMaxSize: parseInt(await getSystemConfig('videoMaxSize')) || config.attachmentPreview.videoMaxSize,
      audioMaxSize: parseInt(await getSystemConfig('audioMaxSize')) || config.attachmentPreview.audioMaxSize,
      lazyLoad: (await getSystemConfig('attachmentLazyLoad')) !== 'false',
      autoLoad: (await getSystemConfig('attachmentAutoLoad')) === 'true',
    };

    res.json({
      ...user,
      noteCount: n?.cnt || 0,
      contactCount: c?.cnt || 0,
      eventCount: e?.cnt || 0,
      todoCount: t?.cnt || 0,
      noteUsage: userDbSizeMB, // 以前只包含笔记，现在包含所有 DB 数据
      fileUsage: fileSizeMB,
      totalDbUsage: totalDbSizeMB,
      dbFreeSpace: dbFreeSpaceMB,
      isAdmin,
      attachmentPreviewConfig
    });
  } catch (e) {
    console.error('[API] Get user-info error:', e);
    res.status(500).json({ error: "系统内部错误" });
  }
});

// 获取所有文件（笔记）- 只返回未删除的
router.get('/api/files', async (req, res) => {
  try {
    // 如果请求参数中包含 includeDeleted=true，则返回所有笔记（包括已删除的）
    // 这用于同步操作，确保所有客户端都能正确处理删除
    const includeDeleted = req.query.includeDeleted === 'true';

    let query = includeDeleted
      ? 'SELECT id, title, content, updatedAt FROM notes WHERE username = ?'
      : 'SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND deleted = 0';

    query += ' ORDER BY updatedAt DESC LIMIT 500';

    res.json(await getConnection().all(query, [req.user]));
  } catch (e) {
    res.status(500).json([]);
  }
});

// 获取指定分类下的笔记（公开访问，用于分享页面）
router.get('/api/notes', async (req, res) => {
  try {
    const category = req.query.category;
    const user = req.query.user;

    if (!user) {
      return res.status(400).json({ error: "缺少用户参数" });
    }

    let query = 'SELECT * FROM notes WHERE username = ? AND deleted = 0';
    const params = [user];

    if (category) {
      query += ' AND title LIKE ?';
      params.push(`${category}/%`);
    }

    query += ' ORDER BY updatedAt DESC';

    const notes = await getConnection().all(query, params);
    res.json(notes);
  } catch (e) {
    console.error('[API] 获取笔记失败:', e);
    res.status(500).json({ error: "获取失败" });
  }
});

// 获取回收站列表（当前用户）- 必须在 /api/notes/:id 之前
router.get('/api/notes/trash', async (req, res) => {
  try {
    const notes = await getConnection().all(
      'SELECT id, title, updatedAt FROM notes WHERE username = ? AND deleted = 1 ORDER BY updatedAt DESC',
      [req.user]
    );
    res.json(notes);
  } catch (e) {
    log('ERROR', '获取回收站失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 恢复笔记 - 必须在 /api/notes/:id 之前
router.put('/api/notes/:id/restore', async (req, res) => {
  try {
    const result = await getConnection().run(
      'UPDATE notes SET deleted = 0, updatedAt = ? WHERE id = ? AND username = ?',
      [Math.floor(Date.now() / 1000), req.params.id, req.user]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: '笔记不存在' });
    }
    log('INFO', '恢复笔记', { username: req.user, noteId: req.params.id });
    res.json({ status: 'ok' });
  } catch (e) {
    log('ERROR', '恢复笔记失败', { username: req.user, noteId: req.params.id, error: e.message });
    res.status(500).json({ error: '恢复失败' });
  }
});

// 永久删除笔记 - 必须在 /api/notes/:id 之前
router.delete('/api/notes/:id/permanent', async (req, res) => {
  try {
    const result = await getConnection().run(
      'DELETE FROM notes WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: '笔记不存在' });
    }
    // 同步删除该笔记的分享链接
    await getConnection().run(
      'DELETE FROM shares WHERE targetType = ? AND target = ? AND owner = ?',
      ['note', req.params.id, req.user]
    );
    log('INFO', '永久删除笔记', { username: req.user, noteId: req.params.id });
    res.json({ status: 'ok' });
  } catch (e) {
    log('ERROR', '永久删除笔记失败', { username: req.user, noteId: req.params.id, error: e.message });
    res.status(500).json({ error: '删除失败' });
  }
});

// 查找重复笔记 - 必须在 /api/notes/:id 之前
router.get('/api/notes/duplicates', async (req, res) => {
  try {
    const db = getConnection();
    const username = req.user;
    const { mode = 'both' } = req.query; // both, title, content

    let duplicates;

    if (mode === 'title') {
      // 只按标题查找重复
      duplicates = await db.all(`
        SELECT title, COUNT(*) as count, GROUP_CONCAT(id) as ids, GROUP_CONCAT(updatedAt) as timestamps
        FROM notes
        WHERE username = ? AND deleted = 0
        GROUP BY title
        HAVING count > 1
        ORDER BY count DESC
      `, [username]);
    } else if (mode === 'content') {
      // 只按内容查找重复
      duplicates = await db.all(`
        SELECT content, COUNT(*) as count, GROUP_CONCAT(id) as ids, GROUP_CONCAT(updatedAt) as timestamps
        FROM notes
        WHERE username = ? AND deleted = 0
        GROUP BY content
        HAVING count > 1
        ORDER BY count DESC
      `, [username]);
    } else {
      // 按标题和内容都相同查找重复（默认）
      duplicates = await db.all(`
        SELECT title, content, COUNT(*) as count, GROUP_CONCAT(id) as ids, GROUP_CONCAT(updatedAt) as timestamps
        FROM notes
        WHERE username = ? AND deleted = 0
        GROUP BY title, content
        HAVING count > 1
        ORDER BY count DESC
      `, [username]);
    }

    // 解析结果
    const result = duplicates.map(dup => ({
      title: dup.title || '(无标题)',
      content: dup.content ? dup.content.substring(0, 100) + (dup.content.length > 100 ? '...' : '') : '(无内容)',
      count: dup.count,
      ids: dup.ids.split(','),
      timestamps: dup.timestamps.split(',').map(t => parseInt(t))
    }));

    res.json({ duplicates: result, totalDuplicates: duplicates.length, mode });
  } catch (e) {
    log('ERROR', '查找重复笔记失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '查找失败' });
  }
});

// 批量去重笔记
router.post('/api/notes/deduplicate', async (req, res) => {
  try {
    const db = getConnection();
    const username = req.user;
    const { mode = 'both' } = req.body; // both, title, content

    let duplicates;

    if (mode === 'title') {
      // 只按标题查找重复
      duplicates = await db.all(`
        SELECT title, COUNT(*) as count, GROUP_CONCAT(id) as ids
        FROM notes
        WHERE username = ? AND deleted = 0
        GROUP BY title
        HAVING count > 1
      `, [username]);
    } else if (mode === 'content') {
      // 只按内容查找重复
      duplicates = await db.all(`
        SELECT content, COUNT(*) as count, GROUP_CONCAT(id) as ids
        FROM notes
        WHERE username = ? AND deleted = 0
        GROUP BY content
        HAVING count > 1
      `, [username]);
    } else {
      // 按标题和内容都相同查找重复（默认）
      duplicates = await db.all(`
        SELECT title, content, COUNT(*) as count, GROUP_CONCAT(id) as ids
        FROM notes
        WHERE username = ? AND deleted = 0
        GROUP BY title, content
        HAVING count > 1
      `, [username]);
    }

    let deletedCount = 0;
    const now = Math.floor(Date.now() / 1000);

    for (const dup of duplicates) {
      const ids = dup.ids.split(',');
      // 保留最新的一个（updatedAt最大），删除其他的
      const notes = await db.all(
        `SELECT id, updatedAt FROM notes WHERE id IN (${ids.map(() => '?').join(',')}) AND username = ?`,
        [...ids, username]
      );

      // 按更新时间排序，保留最新的
      notes.sort((a, b) => b.updatedAt - a.updatedAt);
      const idsToDelete = notes.slice(1).map(n => n.id);

      if (idsToDelete.length > 0) {
        // 移动到回收站而不是直接删除
        const placeholders = idsToDelete.map(() => '?').join(',');
        await db.run(
          `UPDATE notes SET deleted = 1, updatedAt = ? WHERE id IN (${placeholders}) AND username = ?`,
          [now, ...idsToDelete, username]
        );
        deletedCount += idsToDelete.length;
      }
    }

    broadcastNotesUpdate(username);
    log('INFO', '批量去重笔记', { username, deletedCount, mode });
    res.json({ success: true, deletedCount, groupsProcessed: duplicates.length, mode });
  } catch (e) {
    log('ERROR', '批量去重笔记失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '去重失败' });
  }
});

// 获取单个笔记
router.get('/api/notes/:id', async (req, res) => {
  try {
    const note = await getConnection().get(
      'SELECT * FROM notes WHERE id = ? AND username = ?', 
      [req.params.id, req.user]
    );
    if (!note) return res.status(404).json({ error: "笔记不存在" });
    res.json(note);
  } catch (e) { 
    res.status(500).json({ error: "获取失败" }); 
  }
});

// 创建笔记
router.post('/api/notes', async (req, res) => {
  try {
    const { title, content } = req.body;

    // 创建时允许空内容,用户可以后续编辑
    const noteContent = content || '';

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await getConnection().run(
      'INSERT INTO notes (id, username, title, content, updatedAt, deleted) VALUES (?, ?, ?, ?, ?, 0)',
      [id, req.user, sanitizeTitle(title) || '新笔记', noteContent, Math.floor(Date.now() / 1000)]
    );
    const note = await getConnection().get('SELECT * FROM notes WHERE id = ?', [id]);
    res.json(note);

    // 广播笔记更新通知（SSE + WebSocket）
    try {
      broadcastNoteUpdate(req.user, id, note);
      wsBroadcastNoteUpdate(note);
    } catch (e) {
      console.error('[Broadcast] 广播笔记更新失败:', e);
    }
  } catch (e) {
    log('ERROR', '创建笔记失败', { username: req.user, error: e.message });
    res.status(500).json({ error: "创建失败，请稍后重试" });
  }
});

// 更新笔记
router.put('/api/notes/:id', async (req, res) => {
  try {
    const { content, title } = req.body;

    // 验证内容不为空白（仅当content存在时才验证）
    // 如果用户主动清空内容,则标记为删除而非拒绝更新
    if (content !== undefined && content !== null) {
      const trimmedContent = content || '';
      if (trimmedContent.trim().length === 0) {
        // 内容为空时,自动删除笔记
        await getConnection().run(
          'UPDATE notes SET deleted = 1, updatedAt = ? WHERE id = ? AND username = ?',
          [Math.floor(Date.now() / 1000), req.params.id, req.user]
        );
        // 同步删除该笔记的分享链接
        await getConnection().run(
          'DELETE FROM shares WHERE targetType = ? AND target = ? AND owner = ?',
          ['note', req.params.id, req.user]
        );
        // 广播笔记删除通知
        try {
          wsBroadcastNoteDelete(req.params.id);
        } catch (e) {
          console.error('[Broadcast] 广播笔记删除失败:', e);
        }
        return res.json({ status: 'deleted', message: '内容为空，已自动删除笔记' });
      }
    }

    const updatedAt = Math.floor(Date.now() / 1000);
    const cleanTitle = sanitizeTitle(title) || '未命名';
    await getConnection().run(
      'UPDATE notes SET content = COALESCE(?, content), title = ?, updatedAt = ? WHERE id = ? AND username = ?',
      [content !== undefined ? content : null, cleanTitle, updatedAt, req.params.id, req.user]
    );

    // 获取更新后的笔记
    const note = await getConnection().get(
      'SELECT * FROM notes WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    res.json({ status: "ok", note });

    // 广播笔记更新通知（SSE + WebSocket）
    if (note) {
      try {
        console.log('[Broadcast] 广播笔记更新:', req.user, req.params.id);
        broadcastNoteUpdate(req.user, req.params.id, note);
        wsBroadcastNoteUpdate(note);
      } catch (e) {
        console.error('[Broadcast] 广播笔记更新失败:', e);
      }
    }
  } catch (e) {
    log('ERROR', '更新笔记失败', { username: req.user, noteId: req.params.id, error: e.message });
    res.status(500).json({ error: "更新失败，请稍后重试" });
  }
});

// 删除笔记
router.delete('/api/notes/:id', async (req, res) => {
  try {
    await getConnection().run(
      'UPDATE notes SET deleted = 1, updatedAt = ? WHERE id = ? AND username = ?',
      [Math.floor(Date.now() / 1000), req.params.id, req.user]
    );
    // 同步删除该笔记的分享链接
    await getConnection().run(
      'DELETE FROM shares WHERE targetType = ? AND target = ? AND owner = ?',
      ['note', req.params.id, req.user]
    );
    res.json({ status: "ok" });

    // 广播笔记删除通知（WebSocket）
    try {
      wsBroadcastNoteDelete(req.params.id);
    } catch (e) {
      console.error('[Broadcast] 广播笔记删除失败:', e);
    }
  } catch (e) {
    log('ERROR', '删除笔记失败', { username: req.user, noteId: req.params.id, error: e.message });
    res.status(500).json({ error: "删除失败，请稍后重试" });
  }
});

// 批量删除笔记（优化版本）
router.post('/api/notes/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "无效的笔记ID列表" });
    }

    // 限制批量操作数量，防止SQL注入和性能问题
    if (ids.length > 1000) {
      return res.status(400).json({ error: "单次最多删除1000篇笔记" });
    }

    log('INFO', '批量删除笔记开始', { username: req.user, count: ids.length });

    await getConnection().run('BEGIN TRANSACTION');
    try {
      // 优化：使用IN子句批量更新，而不是循环
      const placeholders = ids.map(() => '?').join(',');
      const params = [...ids, req.user];

      const result = await getConnection().run(
        `UPDATE notes SET deleted = 1, updatedAt = ? WHERE id IN (${placeholders}) AND username = ?`,
        [Math.floor(Date.now() / 1000), ...params]
      );

      // 同步删除这些笔记的分享链接
      await getConnection().run(
        `DELETE FROM shares WHERE targetType = 'note' AND target IN (${placeholders}) AND owner = ?`,
        params
      );

      await getConnection().run('COMMIT');

      log('INFO', '批量删除笔记成功', { username: req.user, deletedCount: result.changes });
      res.json({ status: "ok", message: `已删除 ${result.changes} 篇笔记`, count: result.changes });

      // 广播笔记删除通知（WebSocket）
      try {
        ids.forEach(noteId => {
          wsBroadcastNoteDelete(noteId);
        });
      } catch (e) {
        console.error('[Broadcast] 广播批量笔记删除失败:', e);
      }
    } catch (transactionError) {
      await getConnection().run('ROLLBACK');
      throw transactionError;
    }
  } catch (e) {
    log('ERROR', '批量删除笔记失败', { username: req.user, error: e.message });
    res.status(500).json({ error: "批量删除失败，请稍后重试" });
  }
});

// 批量替换笔记（优化版本）
router.post('/api/notes/batch-replace', async (req, res) => {
  try {
    const { ids, findTexts, replaceText } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "无效的笔记ID列表" });
    }

    // 限制批量操作数量
    if (ids.length > 500) {
      return res.status(400).json({ error: "单次最多替换500篇笔记" });
    }

    if (!findTexts || !Array.isArray(findTexts) || findTexts.length === 0) {
      return res.status(400).json({ error: "查找文本不能为空" });
    }

    if (!replaceText || typeof replaceText !== 'string') {
      return res.status(400).json({ error: "替换文本不能为空" });
    }

    const validFindTexts = findTexts.filter(t => t && t.trim() !== '');
    if (validFindTexts.length === 0) {
      return res.status(400).json({ error: "查找文本不能为空" });
    }

    log('INFO', '批量替换笔记开始', {
      username: req.user,
      count: ids.length,
      findTexts: validFindTexts,
      replaceText
    });

    await getConnection().run('BEGIN TRANSACTION');
    try {
      // 优化：一次性查询所有需要替换的笔记
      const placeholders = ids.map(() => '?').join(',');
      const notes = await getConnection().all(
        `SELECT id, title, content FROM notes WHERE id IN (${placeholders}) AND username = ?`,
        [...ids, req.user]
      );

      let replacedCount = 0;
      const now = Math.floor(Date.now() / 1000);

      // 批量更新
      for (const note of notes) {
        let newTitle = note.title;
        for (const findText of validFindTexts) {
          newTitle = newTitle.split(findText).join(replaceText);
        }
        newTitle = sanitizeTitle(newTitle);

        let newContent = note.content || '';
        for (const findText of validFindTexts) {
          newContent = newContent.split(findText).join(replaceText);
        }

        await getConnection().run(
          'UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ?',
          [newTitle, newContent, now, note.id]
        );

        replacedCount++;
      }

      await getConnection().run('COMMIT');

      log('INFO', '批量替换笔记成功', {
        username: req.user,
        replacedCount,
        findTexts: validFindTexts
      });

      res.json({
        status: "ok",
        message: `已替换 ${replacedCount} 篇笔记`,
        count: replacedCount
      });
    } catch (transactionError) {
      await getConnection().run('ROLLBACK');
      log('ERROR', '批量替换事务失败', { username: req.user, error: transactionError.message });
      throw transactionError;
    }
  } catch (e) {
    log('ERROR', '批量替换笔记失败', { username: req.user, error: e.message, stack: e.stack });
    res.status(500).json({ error: "批量替换失败，请稍后重试" });
  }
});

// 批量移动笔记（优化版本）
router.post('/api/notes/batch-move', async (req, res) => {
  try {
    const { ids, targetFolder } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "无效的笔记ID列表" });
    }

    // 限制批量操作数量
    if (ids.length > 500) {
      return res.status(400).json({ error: "单次最多移动500篇笔记" });
    }

    if (!targetFolder || typeof targetFolder !== 'string') {
      return res.status(400).json({ error: "目标文件夹不能为空" });
    }

    const targetFolderName = targetFolder.trim();
    if (!targetFolderName) {
      return res.status(400).json({ error: "目标文件夹不能为空" });
    }

    log('INFO', '批量移动笔记开始', { username: req.user, count: ids.length, targetFolder });

    await getConnection().run('BEGIN TRANSACTION');
    try {
      // 优化：一次性查询所有需要移动的笔记
      const placeholders = ids.map(() => '?').join(',');
      const notes = await getConnection().all(
        `SELECT id, title, content FROM notes WHERE id IN (${placeholders}) AND username = ?`,
        [...ids, req.user]
      );

      let movedCount = 0;
      const now = Math.floor(Date.now() / 1000);

      // 批量更新
      for (const note of notes) {
        let newTitle = note.title;
        let newContent = note.content;

        // 解析当前标题中的分类和标题
        let pureTitle = note.title;
        if (note.title.includes('/')) {
          const parts = note.title.split('/');
          pureTitle = parts.slice(1).join('/').trim() || '未命名';
        }

        // 构建新的标题（分类/标题）
        newTitle = pureTitle ? `${targetFolderName}/${pureTitle}` : targetFolderName;
        newTitle = sanitizeTitle(newTitle);

        // 更新内容的第一行（如果包含分类标记）
        if (newContent && newContent.trim()) {
          const lines = newContent.split('\n');
          if (lines.length > 0) {
            const firstLine = lines[0].trim();

            // 移除 Markdown 标记
            let cleanLine = firstLine.replace(/^#+\s*/, '').trim();

            // 如果第一行包含斜杠，说明有分类标记，需要更新
            if (cleanLine.includes('/')) {
              const parts = cleanLine.split('/');
              const titlePart = parts.slice(1).join('/').trim() || '未命名';
              // 重新构建第一行，保持 Markdown 标记
              const markdownPrefix = firstLine.match(/^#+\s*/)?.[0] || '';
              lines[0] = markdownPrefix + `${targetFolderName}/${titlePart}`;
              newContent = lines.join('\n');
            }
          }
        } else {
          newContent = targetFolderName;
        }

        await getConnection().run(
          'UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ?',
          [newTitle, newContent, now, note.id]
        );

        movedCount++;
      }

      await getConnection().run('COMMIT');

      log('INFO', '批量移动笔记成功', { username: req.user, movedCount, targetFolder });
      res.json({
        status: "ok",
        message: `已移动 ${movedCount} 篇笔记`,
        count: movedCount
      });
    } catch (transactionError) {
      await getConnection().run('ROLLBACK');
      log('ERROR', '批量移动事务失败', { username: req.user, error: transactionError.message });
      throw transactionError;
    }
  } catch (e) {
    log('ERROR', '批量移动笔记失败', { username: req.user, error: e.message, stack: e.stack });
    res.status(500).json({ error: "批量移动失败，请稍后重试" });
  }
});

// 同步笔记（批量插入）
router.post('/api/files', async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const userRow = await getConnection().get('SELECT noteLimit FROM users WHERE username = ?', [req.user]);
    if (!userRow) return res.status(404).json({ error: "用户不存在" });

    const limitMB = parseFloat(userRow.noteLimit || 0);
    const limitBytes = limitMB * 1024 * 1024;

    // 计算当前已用空间
    const noteData = await getConnection().get(
      'SELECT SUM(LENGTH(content)) as size FROM notes WHERE username = ? AND deleted = 0',
      [req.user]
    );
    const currentUsedBytes = noteData?.size || 0;

    // 计算新数据大小
    let newTotalSize = currentUsedBytes;
    const validItems = [];
    const deletedItems = [];

    // 数据过滤和容量检查
    const cutoff = (await getConnection().get(
      'SELECT dataCutoffTime FROM users WHERE username = ?', [req.user]
    ))?.dataCutoffTime || 0;

    for (const item of items) {
      // 过滤旧数据
      if (item.updatedAt <= cutoff) {
        continue;
      }

      // 分类处理删除和更新操作
      if (item.deleted) {
        deletedItems.push(item);
        validItems.push(item);
        continue;
      }

      // 检查内容是否为空，如果为空则标记为删除
      if (item.content !== undefined && item.content !== null && item.content.trim().length === 0) {
        item.deleted = true;
        deletedItems.push(item);
        validItems.push(item);
        continue;
      }

      // 计算每条笔记的大小
      const itemSize = item.content ? Buffer.byteLength(item.content, 'utf8') : 0;

      // 检查是否已有该笔记，计算容量变化
      const existingNote = await getConnection().get(
        'SELECT LENGTH(content) as size FROM notes WHERE id = ? AND username = ?',
        [item.id, req.user]
      );

      if (existingNote) {
        // 已有笔记，计算增量
        newTotalSize += itemSize - (existingNote.size || 0);
      } else {
        // 新笔记
        newTotalSize += itemSize;
      }

      // 容量检查
      if (newTotalSize > limitBytes) {
        return res.status(403).json({
          error: `笔记空间不足，需要 ${(newTotalSize / (1024 * 1024)).toFixed(2)}MB，限制 ${limitMB}MB`
        });
      }

      validItems.push(item);
    }

    if (validItems.length === 0) {
      return res.json({ status: "ok", message: "提交的数据均为旧缓存，已被忽略" });
    }

    // 使用事务批量更新
    await getConnection().run('BEGIN TRANSACTION');
    try {
      // 使用参数化批量插入/更新
      const stmt = await getConnection().prepare(
        `INSERT INTO notes (id, username, title, content, updatedAt, deleted) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title,
           content=excluded.content,
           updatedAt=excluded.updatedAt,
           deleted=excluded.deleted`
      );

      for (const item of validItems) {
        await stmt.run([
          item.id,
          req.user,
          item.title || '未命名',
          item.content || '',
          item.updatedAt || Math.floor(Date.now() / 1000),
          item.deleted ? 1 : 0
        ]);

        console.log('[Sync] 处理笔记:', item.id, 'deleted:', item.deleted, 'title:', item.title);

        // 如果笔记被删除，同步清理分享链接
        if (item.deleted) {
          await getConnection().run(
            'DELETE FROM shares WHERE targetType = ? AND target = ? AND owner = ?',
            ['note', item.id, req.user]
          );
          console.log('[Sync] 清理分享链接:', item.id);
        }
      }

      await stmt.finalize();
      await getConnection().run('COMMIT');

      console.log('[Sync] 批量同步完成:', {
        username: req.user,
        total: validItems.length,
        deleted: deletedItems.length,
        updated: validItems.length - deletedItems.length
      });

      // 为更新的笔记批量广播通知（优化：一次性获取所有更新后的笔记）
      try {
        const updatedIds = validItems.map(item => item.id);
        if (updatedIds.length > 0) {
          const placeholders = updatedIds.map(() => '?').join(',');
          const updatedNotes = await getConnection().all(
            `SELECT * FROM notes WHERE username = ? AND id IN (${placeholders})`,
            [req.user, ...updatedIds]
          );

          if (updatedNotes && updatedNotes.length > 0) {
            // 使用新定义的批量广播函数（如果可用）或快速循环
            for (const note of updatedNotes) {
              broadcastNoteUpdate(req.user, note.id, note);
              wsBroadcastNoteUpdate(note);
            }
            console.log(`[Broadcast] 批量广播了 ${updatedNotes.length} 个笔记更新`);
          }
        }
      } catch (e) {
        console.error('[Broadcast] 批量广播笔记更新失败:', e);
      }

      // 计算实际使用的容量
      const finalNoteData = await getConnection().get(
        'SELECT SUM(LENGTH(content)) as size FROM notes WHERE username = ? AND deleted = 0',
        [req.user]
      );

      res.json({
        status: "ok",
        count: validItems.length,
        deleted: deletedItems.length,
        usage: ((finalNoteData?.size || 0) / (1024 * 1024)).toFixed(2),
        limit: limitMB
      });
    } catch (transactionError) {
      await getConnection().run('ROLLBACK');
      throw transactionError;
    }
  } catch (e) {
    log('ERROR', '笔记同步失败', { username: req.user, error: e.message });
    res.status(500).json({ error: "同步失败" });
  }
});

// 清空回收站（当前用户）
router.delete('/api/notes/trash/empty', async (req, res) => {
  try {
    const result = await getConnection().run(
      'DELETE FROM notes WHERE username = ? AND deleted = 1',
      [req.user]
    );
    log('INFO', '清空回收站', { username: req.user, count: result.changes });
    res.json({ status: 'ok', count: result.changes });
  } catch (e) {
    log('ERROR', '清空回收站失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '清空失败' });
  }
});

module.exports = router;
