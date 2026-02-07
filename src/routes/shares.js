const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { getConnection } = require('../db/connection');
const { genToken } = require('../utils/helpers');
const config = require('../config');
const log = require('../utils/logger');

const router = express.Router();

// 创建分享
router.post('/api/share/create', async (req, res) => {
  try {
    const { type, target, expiresMs = 0, password = '', public: isPublic = true } = req.body;

    if (!['note','file','category'].includes(type)) {
      return res.status(400).json({ error: 'type 必须是 note、file 或 category' });
    }

    if (!target || typeof target !== 'string') {
      return res.status(400).json({ error: '缺少有效的 target' });
    }

    const parsedExpiresMs = parseInt(expiresMs);
    if (isNaN(parsedExpiresMs) || parsedExpiresMs < 0) {
      return res.status(400).json({ error: '无效的过期时间' });
    }

    if (password && typeof password !== 'string') {
      return res.status(400).json({ error: '无效的密码' });
    }

    // 验证分类分享的有效性
    if (type === 'category') {
      const categoryNotes = await getConnection().all(
        'SELECT id FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ?',
        [req.user, `${target}/%`]
      );
      if (categoryNotes.length === 0) {
        return res.status(400).json({ error: '该分类下没有笔记' });
      }
    }

    const token = genToken(24);
    const expiresAt = parsedExpiresMs ? (Date.now() + parsedExpiresMs) : 0;
    await getConnection().run(
      'INSERT INTO shares (token, owner, targetType, target, public, password, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [token, req.user, type, target, isPublic?1:0, password || null, expiresAt]
    );

    // 如果是分类分享，自动分享该分类下的所有笔记
    if (type === 'category') {
      const categoryNotes = await getConnection().all(
        'SELECT id FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ?',
        [req.user, `${target}/%`]
      );

      // 获取该用户已有的分享，避免重复
      const existingShares = await getConnection().all(
        'SELECT target FROM shares WHERE owner = ? AND targetType = ?',
        [req.user, 'note']
      );
      const existingNoteIds = new Set(existingShares.map(s => s.target));

      // 为未分享的笔记创建分享
      for (const note of categoryNotes) {
        if (!existingNoteIds.has(note.id.toString())) {
          const noteToken = genToken(24);
          await getConnection().run(
            'INSERT INTO shares (token, owner, targetType, target, public, password, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [noteToken, req.user, 'note', note.id.toString(), isPublic?1:0, password || null, expiresAt]
          );
        }
      }
    }

    res.json({ status: 'ok', token, url: `${req.protocol}://${req.get('host')}/s/${token}`, expiresAt, type });
  } catch (e) {
    log('ERROR', '创建分享失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '创建失败，请稍后重试' });
  }
});

// 撤销分享
router.post('/api/share/revoke', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: '缺少 token' });
    const row = await getConnection().get('SELECT * FROM shares WHERE token = ?', [token]);
    if (!row) return res.status(404).json({ error: '未找到' });
    if (row.owner !== req.user && !config.adminUsers.includes(req.user)) return res.status(403).json({ error: '无权限' });
    await getConnection().run('DELETE FROM shares WHERE token = ?', [token]);
    res.json({ status: 'ok' });
  } catch (e) { res.status(500).json({ error: '撤销失败' }); }
});

// 批量撤销分享
router.post('/api/share/batch-revoke', async (req, res) => {
  try {
    const { tokens } = req.body;
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ error: '缺少 tokens 参数' });
    }

    // 为管理员用户，撤销所有分享；为普通用户，只撤销自己的分享
    let query, params;
    if (config.adminUsers.includes(req.user)) {
      const placeholders = tokens.map(() => '?').join(',');
      query = `DELETE FROM shares WHERE token IN (${placeholders})`;
      params = tokens;
    } else {
      const placeholders = tokens.map(() => '?').join(',');
      query = `DELETE FROM shares WHERE token IN (${placeholders}) AND owner = ?`;
      params = [...tokens, req.user];
    }

    const result = await getConnection().run(query, params);
    res.json({ status: 'ok', deletedCount: result.changes });
  } catch (e) {
    log('ERROR', '批量撤销分享失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '批量撤销失败' });
  }
});

// 获取用户的分享列表（只返回有效的，自动清理过期和已删除的）
router.get('/api/share/list', async (req, res) => {
  try {
    // 先获取所有分享（包括已过期的，用于清理）
    const allShares = await getConnection().all(
      'SELECT token, targetType, target, public, expiresAt, createdAt, owner FROM shares WHERE owner = ?',
      [req.user]
    );

    const now = Date.now();
    const validShares = [];
    const invalidTokens = [];

    // 检查每个分享的有效性
    for (const share of allShares) {
      const exp = parseInt(share.expiresAt) || 0;
      
      // 检查是否过期
      if (exp && exp < now) {
        invalidTokens.push(share.token);
        continue;
      }
      
      // 检查笔记分享的目标是否存在且未删除
      if (share.targetType === 'note') {
        const note = await getConnection().get(
          'SELECT id FROM notes WHERE id = ? AND username = ? AND deleted = 0',
          [share.target, req.user]
        );
        if (!note) {
          invalidTokens.push(share.token);
          continue;
        }
      }
      
      // 检查分类分享是否还有笔记
      if (share.targetType === 'category') {
        const categoryNotes = await getConnection().all(
          'SELECT id FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ?',
          [req.user, `${share.target}/%`]
        );
        if (categoryNotes.length === 0) {
          invalidTokens.push(share.token);
          continue;
        }
      }
      
      validShares.push(share);
    }

    // 异步清理无效分享（不阻塞响应）
    if (invalidTokens.length > 0) {
      const placeholders = invalidTokens.map(() => '?').join(',');
      getConnection().run(
        `DELETE FROM shares WHERE token IN (${placeholders})`,
        invalidTokens
      ).catch(() => {});
    }

    res.json(validShares);
  } catch (e) { res.status(500).json({ error: '获取失败' }); }
});

// 获取公开分享列表
router.get('/api/share/public-list', async (req, res) => {
  try {
    const shares = await getConnection().all(
      'SELECT * FROM shares WHERE public = 1 AND (expiresAt = 0 OR expiresAt > ?)', 
      [Date.now()]
    );
    const results = [];
    for (const s of shares) {
      let title = '', summary = '', category = '', ownerName = s.owner;
      if (s.targetType === 'note') {
        const note = await getConnection().get(
          'SELECT id, title, content FROM notes WHERE id = ? AND deleted = 0', 
          [s.target]
        );
        if (note) {
          title = note.title || '无标题';
          const plainText = (note.content || '').replace(/[#*`_\[\]]/g, '').trim();
          summary = plainText.length > 150 ? plainText.substring(0, 150) + '...' : plainText;
          if (note.title?.includes('/')) category = note.title.split('/')[0].trim();
        } else {
          // 笔记已删除，自动清理分享记录
          await getConnection().run('DELETE FROM shares WHERE token = ?', [s.token]);
        }
      } else if (s.targetType === 'category') {
        // 分类分享
        const categoryNotes = await getConnection().all(
          'SELECT id FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ?',
          [s.owner, `${s.target}/%`]
        );
        if (categoryNotes.length > 0) {
          title = `${s.target} (${categoryNotes.length}篇)`;
          summary = `分类分享，包含 ${categoryNotes.length} 篇笔记`;
          category = s.target;
        } else {
          // 分类下无笔记，自动清理分享记录
          await getConnection().run('DELETE FROM shares WHERE token = ?', [s.token]);
          title = null;
        }
      } else {
        const safePath = path.normalize(s.target).replace(/^(\.\.(\/|\\|$))+/, '');
        const filePath = path.join(config.paths.uploads, safePath);
        try {
          await fs.access(filePath);
          title = s.target.split('/').pop() || s.target;
          summary = '文件分享';
          category = '文件';
        } catch (err) {
          // 文件不存在，自动清理分享记录
          await getConnection().run('DELETE FROM shares WHERE token = ?', [s.token]);
          title = null;
        }
      }
      if (title) {
        results.push({ 
          token: s.token, type: s.targetType, target: s.target, title, summary, 
          category: category || '未分类', owner: ownerName, createdAt: s.createdAt, expiresAt: s.expiresAt 
        });
      }
    }
    res.json(results);
  } catch (e) {
    log('ERROR', '获取公开分享失败', { error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取公开分享详情
router.get('/api/share/public/:token', async (req, res) => {
  try {
    const token = req.params.token;
    
    // 检查是否是分类分享 + note ID 的格式
    let categoryShare = null;
    let noteId = null;
    
    if (token.includes('?note=')) {
      const parts = token.split('?note=');
      const categoryToken = parts[0];
      noteId = parts[1];
      
      // 查找分类分享
      categoryShare = await getConnection().get('SELECT * FROM shares WHERE token = ?', [categoryToken]);
      
      if (!categoryShare || categoryShare.targetType !== 'category') {
        return res.status(404).json({ error: 'not found' });
      }
      
      // 检查分类分享是否有效
      const exp = parseInt(categoryShare.expiresAt) || 0;
      if (exp && Date.now() > exp) {
        await getConnection().run('DELETE FROM shares WHERE token = ?', [categoryToken]);
        return res.status(410).json({ error: 'expired' });
      }
      
      if (!categoryShare.public) return res.status(403).json({ error: 'private' });
      
      // 查找笔记
      const note = await getConnection().get(
        'SELECT id, title, content, updatedAt FROM notes WHERE id = ? AND username = ? AND deleted = 0',
        [noteId, categoryShare.owner]
      );
      
      if (!note) {
        return res.status(404).json({ error: 'note not found' });
      }
      
      // 检查笔记是否属于该分类
      if (!note.title || !note.title.startsWith(categoryShare.target + '/')) {
        return res.status(404).json({ error: 'note not in category' });
      }
      
      // 自动为该笔记创建分享记录（如果还没有）
      const existingShare = await getConnection().get(
        'SELECT * FROM shares WHERE targetType = ? AND target = ?',
        ['note', noteId]
      );
      
      if (!existingShare) {
        const noteToken = genToken(24);
        await getConnection().run(
          'INSERT INTO shares (token, owner, targetType, target, public, password, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [noteToken, categoryShare.owner, 'note', noteId, categoryShare.public, categoryShare.password, categoryShare.expiresAt]
        );
      }
      
      // 返回笔记详情
      const userConfig = await getConnection().get(
        'SELECT blogTitle, blogSubtitle, blogTheme, blogShowHeader, blogShowFooter, customCSS FROM users WHERE username = ?', 
        [categoryShare.owner]
      );
      const blogConfig = {
        blogTitle: userConfig?.blogTitle || `${categoryShare.owner} 的博客`,
        blogSubtitle: userConfig?.blogSubtitle || '我的公开笔记与分享',
        blogTheme: userConfig?.blogTheme || 'light',
        blogShowHeader: userConfig?.blogShowHeader !== 0,
        blogShowFooter: userConfig?.blogShowFooter !== 0,
        customCSS: userConfig?.customCSS || ''
      };
      
      let category = note.title?.includes('/') ? note.title.split('/')[0].trim() : '未分类';
      
      return res.json({
        type: 'note',
        note,
        category,
        owner: categoryShare.owner,
        blogConfig
      });
    }
    
    // 原有的逻辑处理普通分享
    const row = await getConnection().get('SELECT * FROM shares WHERE token = ?', [token]);
    if (!row) return res.status(404).json({ error: 'not found' });
    const exp = parseInt(row.expiresAt) || 0;
    if (exp && Date.now() > exp) {
      // 分享已过期，自动清理
      await getConnection().run('DELETE FROM shares WHERE token = ?', [token]);
      return res.status(410).json({ error: 'expired' });
    }
    if (!row.public) return res.status(403).json({ error: 'private' });

    const userConfig = await getConnection().get(
      'SELECT blogTitle, blogSubtitle, blogTheme, blogShowHeader, blogShowFooter, customCSS FROM users WHERE username = ?', 
      [row.owner]
    );
    const blogConfig = {
      blogTitle: userConfig?.blogTitle || `${row.owner} 的博客`,
      blogSubtitle: userConfig?.blogSubtitle || '我的公开笔记与分享',
      blogTheme: userConfig?.blogTheme || 'light',
      blogShowHeader: userConfig?.blogShowHeader !== 0,
      blogShowFooter: userConfig?.blogShowFooter !== 0,
      customCSS: userConfig?.customCSS || ''
    };

    const allShares = await getConnection().all(
      'SELECT * FROM shares WHERE public = 1 AND owner = ? AND (expiresAt = 0 OR expiresAt > ?) ORDER BY createdAt DESC',
      [row.owner, Date.now()]
    );
    const categoryShares = [];
    const categoryCount = {};
    const categoryTokens = {}; // 分类对应的token

    for (const s of allShares) {
      let category = '', title = '';
      if (s.targetType === 'note') {
        const note = await getConnection().get(
          'SELECT id, title FROM notes WHERE id = ? AND deleted = 0',
          [s.target]
        );
        if (note) {
          title = note.title || '无标题';
          if (note.title?.includes('/')) category = note.title.split('/')[0].trim();
        }
      } else { title = s.target.split('/').pop() || s.target; category = '文件'; }
      if (title) {
        const catName = category || '未分类';
        categoryCount[catName] = (categoryCount[catName] || 0) + 1;
        categoryShares.push({ token: s.token, type: s.targetType, title, category: catName });
        // 保存分类对应的token（如果是分类分享）
        if (s.targetType === 'category' && s.target === catName && !categoryTokens[catName]) {
          categoryTokens[catName] = s.token;
        }
        // 如果是笔记分享，但还没有该分类的token，创建一个基于用户的token
        if (s.targetType === 'note' && catName && catName !== '未分类' && !categoryTokens[catName]) {
          categoryTokens[catName] = `cat-${catName}`;
        }
      }
    }

    if (row.targetType === 'note') {
      const note = await getConnection().get(
        'SELECT id, title, content, updatedAt FROM notes WHERE id = ? AND deleted = 0', 
        [row.target]
      );
      if (!note) {
        // 笔记已删除，自动清理分享记录
        await getConnection().run('DELETE FROM shares WHERE token = ?', [token]);
        return res.status(404).json({ error: 'note not found' });
      }
      let category = note.title?.includes('/') ? note.title.split('/')[0].trim() : '未分类';
      const currentCategory = category || '未分类';
      const sameCategoryShares = categoryShares.filter(s => s.category === currentCategory);
      const currentIndex = sameCategoryShares.findIndex(s => s.token === token);
      return res.json({
        type: 'note', note, category, owner: row.owner, blogConfig, categoryCount, categoryTokens,
        prevShare: currentIndex > 0 ? sameCategoryShares[currentIndex - 1] : null,
        nextShare: currentIndex < sameCategoryShares.length - 1 ? sameCategoryShares[currentIndex + 1] : null
      });
    } else if (row.targetType === 'category') {
      // 分类分享：获取该分类下所有笔记
      const categoryName = row.target;
      const notes = await getConnection().all(
        'SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ? ORDER BY updatedAt DESC',
        [row.owner, `${categoryName}/%`]
      );
      if (notes.length === 0) {
        // 分类下无笔记，自动清理分享记录
        await getConnection().run('DELETE FROM shares WHERE token = ?', [token]);
        return res.status(404).json({ error: 'category empty' });
      }

      // 获取该用户已有的笔记分享
      const existingShares = await getConnection().all(
        'SELECT target FROM shares WHERE owner = ? AND targetType = ?',
        [row.owner, 'note']
      );
      const existingNoteIds = new Set(existingShares.map(s => s.target));

      // 为未分享的笔记自动创建分享记录
      for (const note of notes) {
        if (!existingNoteIds.has(note.id.toString())) {
          const noteToken = genToken(24);
          await getConnection().run(
            'INSERT INTO shares (token, owner, targetType, target, public, password, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [noteToken, row.owner, 'note', note.id.toString(), row.public, row.password, row.expiresAt]
          );
        }
      }

      // 处理笔记数据
      const processedNotes = notes.map(note => ({
        id: note.id,
        title: note.title.split('/').slice(1).join('/') || note.title, // 去掉分类前缀
        fullTitle: note.title,
        content: note.content,
        updatedAt: note.updatedAt
      }));

      return res.json({
        type: 'category',
        category: categoryName,
        categoryToken: token, // 当前分类的分享token
        notes: processedNotes,
        owner: row.owner,
        blogConfig,
        categoryCount,
        categoryTokens
      });
    } else {
      const currentCategory = '文件';
      const sameCategoryShares = categoryShares.filter(s => s.category === currentCategory);
      const currentIndex = sameCategoryShares.findIndex(s => s.token === token);
      return res.json({ 
        type: 'file', target: row.target, category: '文件', owner: row.owner, blogConfig, categoryCount, 
        prevShare: currentIndex > 0 ? sameCategoryShares[currentIndex - 1] : null, 
        nextShare: currentIndex < sameCategoryShares.length - 1 ? sameCategoryShares[currentIndex + 1] : null 
      });
    }
  } catch (e) {
    log('ERROR', '获取分享详情失败', { error: e.message });
    res.status(500).json({ error: 'server error' });
  }
});

// 访问分享链接
router.get('/s/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const row = await getConnection().get('SELECT * FROM shares WHERE token = ?', [token]);
    if (!row) return res.status(404).send('分享链接不存在');
    const exp2 = parseInt(row.expiresAt) || 0;
    if (exp2 && Date.now() > exp2) {
      // 分享已过期，自动清理
      await getConnection().run('DELETE FROM shares WHERE token = ?', [token]);
      return res.status(410).send('分享链接已过期');
    }
    if (!row.public) return res.status(403).send('分享链接是私有的');

    if (row.targetType === 'file') {
      // 文件直接下载
      const userDir = row.owner || '';
      const safe = path.normalize(row.target).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = path.join(config.paths.uploads, userDir, safe);
      if (!path.resolve(filePath).startsWith(path.resolve(config.paths.uploads))) return res.status(400).send('无效的文件路径');
      try {
        await fs.access(filePath);
        return res.sendFile(filePath);
      } catch (err) {
        console.error('[Share] File not found:', filePath);
        return res.status(404).send('文件不存在或已被删除');
      }
    } else if (row.targetType === 'category') {
      // 分类分享重定向到分享列表页面
      return res.redirect(`/shares.html?user=${encodeURIComponent(row.owner)}&category=${encodeURIComponent(row.target)}`);
    } else {
      // 笔记分享跳转到预览页面
      return res.redirect(`/share.html?token=${encodeURIComponent(token)}`);
    }
  } catch (e) { console.error('[Share] Error:', e); res.status(500).send('服务器错误'); }
});

// 通过分享链接获取附件
router.get('/api/share/attachment/:token/:filename(*)', async (req, res) => {
  try {
    const { token } = req.params;
    const filename = req.params.filename || '';
    const share = await getConnection().get('SELECT * FROM shares WHERE token = ?', [token]);
    if (!share) return res.status(404).send('Share not found');
    if (!share.public) return res.status(403).send('Private share');
    const exp3 = parseInt(share.expiresAt) || 0;
    if (exp3 && Date.now() > exp3) {
      // 分享已过期，自动清理
      await getConnection().run('DELETE FROM shares WHERE token = ?', [token]);
      return res.status(410).send('Share expired');
    }

    const safeFilename = path.normalize(filename).replace(/^\.\//, '').replace(/^\.\\/, '');
    if (safeFilename !== filename) {
      return res.status(400).send('Invalid filename');
    }

    const filePath = path.join(config.paths.uploads, safeFilename);

    if (!path.resolve(filePath).startsWith(path.resolve(config.paths.uploads))) {
      return res.status(400).send('Bad request');
    }

    try { await fs.access(filePath); } catch (err) { return res.status(404).send('File not found'); }
    return res.sendFile(filePath);
  } catch (err) { console.error('[Share Attachment] Error:', err); return res.status(500).send('Server error'); }
});

module.exports = router;
