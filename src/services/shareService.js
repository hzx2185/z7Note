const path = require('path');
const fs = require('fs').promises;
const db = require('../db/client');
const config = require('../config');
const { genToken } = require('../utils/helpers');
const { safePath: buildSafePath, isValidFilename } = require('../utils/path');

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

async function buildBlogConfig(username) {
  const userConfig = await db.queryOne(
    'SELECT blogTitle, blogSubtitle, blogTheme, blogShowHeader, blogShowFooter, customCSS FROM users WHERE username = ?',
    [username]
  );

  return {
    blogTitle: userConfig?.blogTitle || `${username} 的博客`,
    blogSubtitle: userConfig?.blogSubtitle || '我的公开笔记与分享',
    blogTheme: userConfig?.blogTheme || 'light',
    blogShowHeader: userConfig?.blogShowHeader !== 0,
    blogShowFooter: userConfig?.blogShowFooter !== 0,
    customCSS: userConfig?.customCSS || ''
  };
}

async function collectOwnerShareContext(owner) {
  const allShares = await db.queryAll(
    'SELECT * FROM shares WHERE public = 1 AND owner = ? AND (expiresAt = 0 OR expiresAt > ?) ORDER BY createdAt DESC',
    [owner, Date.now()]
  );
  const categoryShares = [];
  const categoryCount = {};
  const categoryTokens = {};

  for (const share of allShares) {
    let category = '';
    let title = '';

    if (share.targetType === 'note') {
      const note = await db.queryOne(
        'SELECT id, title FROM notes WHERE id = ? AND username = ? AND deleted = 0',
        [share.target, share.owner]
      );
      if (note) {
        title = note.title || '无标题';
        if (note.title?.includes('/')) {
          category = note.title.split('/')[0].trim();
        }
      }
    } else {
      title = share.target.split('/').pop() || share.target;
      category = '文件';
    }

    if (!title) {
      continue;
    }

    const categoryName = category || '未分类';
    categoryCount[categoryName] = (categoryCount[categoryName] || 0) + 1;
    categoryShares.push({ token: share.token, type: share.targetType, title, category: categoryName });

    if (share.targetType === 'category' && share.target === categoryName && !categoryTokens[categoryName]) {
      categoryTokens[categoryName] = share.token;
    }

    if (share.targetType === 'note' && categoryName !== '未分类' && !categoryTokens[categoryName]) {
      categoryTokens[categoryName] = `cat-${categoryName}`;
    }
  }

  return {
    categoryShares,
    categoryCount,
    categoryTokens
  };
}

async function ensureCategoryNoteShares(owner, categoryName, isPublic, expiresAt) {
  const notes = await db.queryAll(
    'SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND deleted = 0 AND title LIKE ? ORDER BY updatedAt DESC',
    [owner, `${categoryName}/%`]
  );

  if (notes.length === 0) {
    return [];
  }

  const existingShares = await db.queryAll(
    'SELECT target FROM shares WHERE owner = ? AND targetType = ?',
    [owner, 'note']
  );
  const existingNoteIds = new Set(existingShares.map(share => share.target));

  for (const note of notes) {
    if (!existingNoteIds.has(note.id.toString())) {
      const noteToken = genToken(24);
      await db.execute(
        'INSERT INTO shares (token, owner, targetType, target, public, password, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [noteToken, owner, 'note', note.id.toString(), isPublic ? 1 : 0, null, expiresAt]
      );
    }
  }

  return notes;
}

module.exports = {
  resolveOwnedFilePath,
  ensureShareTargetOwned,
  isAttachmentAllowedForShare,
  buildBlogConfig,
  collectOwnerShareContext,
  ensureCategoryNoteShares,
  isValidFilename
};
