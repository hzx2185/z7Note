const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const db = require('../db/client');
const { genToken } = require('../utils/helpers');
const config = require('../config');
const log = require('../utils/logger');
const { safePath: buildSafePath, isValidFilename } = require('../utils/path');

const router = express.Router();

function getUserUploadDir(username) {
  return path.join(config.paths.uploads, username);
}

function resolveOwnedFilePath(username, target) {
  if (typeof target !== 'string' || !target.trim()) {
    throw new Error('缺少有效的文件路径');
  }

  const normalizedTarget = path.normalize(target).replace(/^([/\\])+/, '');
  const userDir = getUserUploadDir(username);

  return {
    normalizedTarget,
    filePath: buildSafePath(userDir, normalizedTarget)
  };
}

async function ensureShareTargetOwned(type, target, owner) {
  if (type === 'note') {
    const note = await db.queryOne(
      'SELECT id FROM notes WHERE id = ? AND username = ? AND deleted = 0',
      [target, owner]
    );
    if (!note) {
      throw new Error('笔记不存在或无权分享');
    }
    return target;
  }

  if (type === 'file') {
    const { normalizedTarget, filePath } = resolveOwnedFilePath(owner, target);
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error('文件不存在或无权分享');
    }
    return normalizedTarget;
  }

  if (type === 'category') {
    const categoryNotes = await db.queryAll(
      'SELECT id FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ?',
      [owner, `${target}/%`]
    );
    if (categoryNotes.length === 0) {
      throw new Error('该分类下没有笔记');
    }
    return target;
  }

  throw new Error('无效的分享类型');
}

function extractAttachmentCandidates(content) {
  const candidates = new Set();
  if (!content) {
    return candidates;
  }

  const patterns = [
    /!\[[^\]]*\]\(([^)]+)\)/g,
    /\[[^\]]*\]\(([^)]+)\)/g,
    /!\[\[([^\]]+)\]\]/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const rawValue = (match[1] || '').trim();
      if (!rawValue || rawValue.startsWith('http://') || rawValue.startsWith('https://')) {
        continue;
      }

      const cleaned = rawValue.split('?')[0].split('#')[0];
      const basename = path.basename(cleaned);
      if (basename) {
        candidates.add(basename);
      }
    }
  }

  return candidates;
}

async function isAttachmentAllowedForShare(share, requestedFilename) {
  const basename = path.basename(requestedFilename || '');
  if (!basename || !isValidFilename(basename)) {
    return false;
  }

  if (share.targetType === 'file') {
    return path.basename(share.target) === basename;
  }

  if (share.targetType === 'note') {
    const note = await db.queryOne(
      'SELECT content FROM notes WHERE id = ? AND username = ? AND deleted = 0',
      [share.target, share.owner]
    );
    return !!note && extractAttachmentCandidates(note.content).has(basename);
  }

  if (share.targetType === 'category') {
    const notes = await db.queryAll(
      'SELECT content FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ?',
      [share.owner, `${share.target}/%`]
    );
    return notes.some(note => extractAttachmentCandidates(note.content).has(basename));
  }

  return false;
}

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

    if (password) {
      return res.status(400).json({ error: '暂不支持密码分享，请使用公开分享' });
    }

    const normalizedTarget = await ensureShareTargetOwned(type, target, req.user);

    const token = genToken(24);
    const expiresAt = parsedExpiresMs ? (Date.now() + parsedExpiresMs) : 0;
    await db.execute(
      'INSERT INTO shares (token, owner, targetType, target, public, password, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [token, req.user, type, normalizedTarget, isPublic?1:0, null, expiresAt]
    );

    // 如果是分类分享，自动分享该分类下的所有笔记
    if (type === 'category') {
      const categoryNotes = await db.queryAll(
        'SELECT id FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ?',
        [req.user, `${normalizedTarget}/%`]
      );

      // 获取该用户已有的分享，避免重复
      const existingShares = await db.queryAll(
        'SELECT target FROM shares WHERE owner = ? AND targetType = ?',
        [req.user, 'note']
      );
      const existingNoteIds = new Set(existingShares.map(s => s.target));

      // 为未分享的笔记创建分享
      for (const note of categoryNotes) {
        if (!existingNoteIds.has(note.id.toString())) {
          const noteToken = genToken(24);
          await db.execute(
            'INSERT INTO shares (token, owner, targetType, target, public, password, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [noteToken, req.user, 'note', note.id.toString(), isPublic?1:0, null, expiresAt]
          );
        }
      }
    }

    res.json({ status: 'ok', token, url: `${req.protocol}://${req.get('host')}/s/${token}`, expiresAt, type });
  } catch (e) {
    if (['笔记不存在或无权分享', '文件不存在或无权分享', '该分类下没有笔记', '无效的分享类型', '缺少有效的文件路径'].includes(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    log('ERROR', '创建分享失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '创建失败，请稍后重试' });
  }
});

// 撤销分享
router.post('/api/share/revoke', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: '缺少 token' });
    const row = await db.queryOne('SELECT * FROM shares WHERE token = ?', [token]);
    if (!row) return res.status(404).json({ error: '未找到' });
    if (row.owner !== req.user && !config.adminUsers.includes(req.user)) return res.status(403).json({ error: '无权限' });
    await db.execute('DELETE FROM shares WHERE token = ?', [token]);
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

    const result = await db.execute(query, params);
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
    const allShares = await db.queryAll(
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
        const note = await db.queryOne(
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
        const categoryNotes = await db.queryAll(
          'SELECT id FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ?',
          [req.user, `${share.target}/%`]
        );
        if (categoryNotes.length === 0) {
          invalidTokens.push(share.token);
          continue;
        }
      }

      if (share.targetType === 'file') {
        try {
          const { filePath } = resolveOwnedFilePath(req.user, share.target);
          await fs.access(filePath);
        } catch (error) {
          invalidTokens.push(share.token);
          continue;
        }
      }
      
      validShares.push(share);
    }

    // 异步清理无效分享（不阻塞响应）
    if (invalidTokens.length > 0) {
      const placeholders = invalidTokens.map(() => '?').join(',');
      db.execute(
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
    const shares = await db.queryAll(
      'SELECT * FROM shares WHERE public = 1 AND (expiresAt = 0 OR expiresAt > ?)', 
      [Date.now()]
    );
    const results = [];
    for (const s of shares) {
      let title = '', summary = '', category = '', ownerName = s.owner;
      if (s.targetType === 'note') {
        const note = await db.queryOne(
          'SELECT id, title, content FROM notes WHERE id = ? AND username = ? AND deleted = 0', 
          [s.target, s.owner]
        );
        if (note) {
          title = note.title || '无标题';
          const plainText = (note.content || '').replace(/[#*`_\[\]]/g, '').trim();
          summary = plainText.length > 150 ? plainText.substring(0, 150) + '...' : plainText;
          if (note.title?.includes('/')) category = note.title.split('/')[0].trim();
        } else {
          // 笔记已删除，自动清理分享记录
          await db.execute('DELETE FROM shares WHERE token = ?', [s.token]);
        }
      } else if (s.targetType === 'category') {
        // 分类分享
        const categoryNotes = await db.queryAll(
          'SELECT id FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ?',
          [s.owner, `${s.target}/%`]
        );
        if (categoryNotes.length > 0) {
          title = `${s.target} (${categoryNotes.length}篇)`;
          summary = `分类分享，包含 ${categoryNotes.length} 篇笔记`;
          category = s.target;
        } else {
          // 分类下无笔记，自动清理分享记录
          await db.execute('DELETE FROM shares WHERE token = ?', [s.token]);
          title = null;
        }
      } else {
        try {
          const { filePath } = resolveOwnedFilePath(s.owner, s.target);
          await fs.access(filePath);
          title = s.target.split('/').pop() || s.target;
          summary = '文件分享';
          category = '文件';
        } catch (err) {
          // 文件不存在，自动清理分享记录
          await db.execute('DELETE FROM shares WHERE token = ?', [s.token]);
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
      categoryShare = await db.queryOne('SELECT * FROM shares WHERE token = ?', [categoryToken]);
      
      if (!categoryShare || categoryShare.targetType !== 'category') {
        return res.status(404).json({ error: 'not found' });
      }
      
      // 检查分类分享是否有效
      const exp = parseInt(categoryShare.expiresAt) || 0;
      if (exp && Date.now() > exp) {
        await db.execute('DELETE FROM shares WHERE token = ?', [categoryToken]);
        return res.status(410).json({ error: 'expired' });
      }
      
      if (!categoryShare.public) return res.status(403).json({ error: 'private' });
      
      // 查找笔记
      const note = await db.queryOne(
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
      const existingShare = await db.queryOne(
        'SELECT * FROM shares WHERE owner = ? AND targetType = ? AND target = ?',
        [categoryShare.owner, 'note', noteId]
      );
      
      if (!existingShare) {
        const noteToken = genToken(24);
        await db.execute(
          'INSERT INTO shares (token, owner, targetType, target, public, password, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [noteToken, categoryShare.owner, 'note', noteId, categoryShare.public, null, categoryShare.expiresAt]
        );
      }
      
      // 返回笔记详情
      const userConfig = await db.queryOne(
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
    const row = await db.queryOne('SELECT * FROM shares WHERE token = ?', [token]);
    if (!row) return res.status(404).json({ error: 'not found' });
    const exp = parseInt(row.expiresAt) || 0;
    if (exp && Date.now() > exp) {
      // 分享已过期，自动清理
      await db.execute('DELETE FROM shares WHERE token = ?', [token]);
      return res.status(410).json({ error: 'expired' });
    }
    if (!row.public) return res.status(403).json({ error: 'private' });

    const userConfig = await db.queryOne(
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

    const allShares = await db.queryAll(
      'SELECT * FROM shares WHERE public = 1 AND owner = ? AND (expiresAt = 0 OR expiresAt > ?) ORDER BY createdAt DESC',
      [row.owner, Date.now()]
    );
    const categoryShares = [];
    const categoryCount = {};
    const categoryTokens = {}; // 分类对应的token

    for (const s of allShares) {
      let category = '', title = '';
      if (s.targetType === 'note') {
        const note = await db.queryOne(
          'SELECT id, title FROM notes WHERE id = ? AND username = ? AND deleted = 0',
          [s.target, s.owner]
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
      const note = await db.queryOne(
        'SELECT id, title, content, updatedAt FROM notes WHERE id = ? AND username = ? AND deleted = 0', 
        [row.target, row.owner]
      );
      if (!note) {
        // 笔记已删除，自动清理分享记录
        await db.execute('DELETE FROM shares WHERE token = ?', [token]);
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
      const notes = await db.queryAll(
        'SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ? ORDER BY updatedAt DESC',
        [row.owner, `${categoryName}/%`]
      );
      if (notes.length === 0) {
        // 分类下无笔记，自动清理分享记录
        await db.execute('DELETE FROM shares WHERE token = ?', [token]);
        return res.status(404).json({ error: 'category empty' });
      }

      // 获取该用户已有的笔记分享
      const existingShares = await db.queryAll(
        'SELECT target FROM shares WHERE owner = ? AND targetType = ?',
        [row.owner, 'note']
      );
      const existingNoteIds = new Set(existingShares.map(s => s.target));

      // 为未分享的笔记自动创建分享记录
      for (const note of notes) {
        if (!existingNoteIds.has(note.id.toString())) {
          const noteToken = genToken(24);
          await db.execute(
            'INSERT INTO shares (token, owner, targetType, target, public, password, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [noteToken, row.owner, 'note', note.id.toString(), row.public, null, row.expiresAt]
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
    const row = await db.queryOne('SELECT * FROM shares WHERE token = ?', [token]);
    if (!row) return res.status(404).send('分享链接不存在');
    const exp2 = parseInt(row.expiresAt) || 0;
    if (exp2 && Date.now() > exp2) {
      // 分享已过期，自动清理
      await db.execute('DELETE FROM shares WHERE token = ?', [token]);
      return res.status(410).send('分享链接已过期');
    }
    if (!row.public) return res.status(403).send('分享链接是私有的');

    if (row.targetType === 'file') {
      // 文件直接下载
      let filePath = '';
      try {
        ({ filePath } = resolveOwnedFilePath(row.owner || '', row.target));
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
    const share = await db.queryOne('SELECT * FROM shares WHERE token = ?', [token]);
    if (!share) return res.status(404).send('Share not found');
    if (!share.public) return res.status(403).send('Private share');
    const exp3 = parseInt(share.expiresAt) || 0;
    if (exp3 && Date.now() > exp3) {
      // 分享已过期，自动清理
      await db.execute('DELETE FROM shares WHERE token = ?', [token]);
      return res.status(410).send('Share expired');
    }

    const requestedName = path.basename(filename);
    if (requestedName !== filename.split('/').pop() || !isValidFilename(requestedName)) {
      return res.status(400).send('Invalid filename');
    }

    const allowed = await isAttachmentAllowedForShare(share, requestedName);
    if (!allowed) {
      return res.status(403).send('Forbidden');
    }

    const { filePath } = resolveOwnedFilePath(share.owner, requestedName);
    try { await fs.access(filePath); } catch (err) { return res.status(404).send('File not found'); }
    return res.sendFile(filePath);
  } catch (err) { console.error('[Share Attachment] Error:', err); return res.status(500).send('Server error'); }
});

module.exports = router;
