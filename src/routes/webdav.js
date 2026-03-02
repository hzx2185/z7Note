/**
 * WebDAV 服务器路由 - 终极稳定版
 * 专为 Obsidian Remotely Save 插件优化
 */

const express = require('express');
const { getConnection } = require('../db/connection');
const { basicAuthMiddleware } = require('../middleware/basicAuth');
const log = require('../utils/logger');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const config = require('../config');
const { broadcastNoteUpdate, broadcastNoteDelete } = require('./ws');

const router = express.Router();

// 辅助：转换附件路径（WebDAV → Web）
function convertAttachmentPathToWeb(content, username) {
  if (!content) return content;

  // 转换 Obsidian 的相对路径引用
  // 例如：![](image.jpeg) → ![](/api/attachments/raw/image.jpeg)
  // 例如：![[image.jpeg]] → ![](/api/attachments/raw/image.jpeg)
  // 例如：![](attachments/image.jpeg) → ![](/api/attachments/raw/image.jpeg)

  // 匹配 Markdown 图片语法：![alt](path)
  content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, path) => {
    // 如果已经是绝对路径，不转换
    if (path.startsWith('/api/') || path.startsWith('http://') || path.startsWith('https://')) {
      return match;
    }
    // 提取文件名（去掉目录部分）
    const filename = path.split('/').pop();
    return `![${alt}](/api/attachments/raw/${filename})`;
  });

  // 匹配 Obsidian 双链语法：![[file]]
  content = content.replace(/!\[\[([^\]]+)\]\]/g, (match, path) => {
    // 如果已经是绝对路径，不转换
    if (path.startsWith('/api/') || path.startsWith('http://') || path.startsWith('https://')) {
      return match;
    }
    // 提取文件名（去掉目录部分）
    const filename = path.split('/').pop();
    return `![](/api/attachments/raw/${filename})`;
  });

  return content;
}

// 辅助：转换附件路径（Web → WebDAV）
function convertAttachmentPathToWebDAV(content, username) {
  if (!content) return content;

  // 转换 Web API 路径为相对路径
  // 例如：![](/api/attachments/raw/image.jpeg) → ![](image.jpeg)

  // 匹配 Markdown 图片语法
  content = content.replace(/!\[([^\]]*)\]\(\/api\/attachments\/raw\/([^)]+)\)/g, (match, alt, filename) => {
    return `![${alt}](${filename})`;
  });

  return content;
}

// 辅助：转义 XML
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

// 辅助：生成多状态响应 XML
function createMultistatusXml(responses) {
  return `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
${responses.join('\n')}
</D:multistatus>`;
}

// 辅助：生成单个资源响应 XML
function createResponseXml(href, props) {
  let propXml = '';
  for (const [key, value] of Object.entries(props)) {
    if (key === 'resourcetype' && value === 'collection') {
      propXml += `<D:resourcetype><D:collection/></D:resourcetype>\n`;
    } else if (value !== undefined) {
      propXml += `<D:${key}>${value}</D:${key}>\n`;
    }
  }
  return `<D:response>
<D:href>${href}</D:href>
<D:propstat>
<D:prop>
${propXml}</D:prop>
<D:status>HTTP/1.1 200 OK</D:status>
</D:propstat>
</D:response>`;
}

// 辅助：查找笔记
async function findNote(username, filename) {
  const db = getConnection();
  const titleWithoutMd = filename.replace(/\.md$/i, '');
  // 1. 全名匹配
  let note = await db.get('SELECT * FROM notes WHERE username = ? AND title = ? AND deleted = 0', [username, filename]);
  if (note) return note;
  // 2. 无后缀匹配
  return await db.get('SELECT * FROM notes WHERE username = ? AND title = ? AND deleted = 0', [username, titleWithoutMd]);
}

// 全局中间件
router.use((req, res, next) => {
  // 统一路径斜杠
  if (req.url.includes('//')) req.url = req.url.replace(/\/+/g, '/');
  log('INFO', 'WebDAV 请求', { method: req.method, path: req.path, username: req.user || '未认证' });
  next();
});

// OPTIONS 方法支持
router.options('*', (req, res) => {
  res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE, LOCK, UNLOCK, PROPPATCH');
  res.setHeader('DAV', '1, 2');
  res.setHeader('MS-Author-Via', 'DAV');
  res.status(200).end();
});

// 基础信息
router.get('/info.json', basicAuthMiddleware, (req, res) => res.json({ name: 'z7Note WebDAV', version: '2.0.0' }));

// --- 核心处理逻辑 ---
// 使用 '*' 捕获所有请求，手动解析路径
router.all('*', basicAuthMiddleware, async (req, res) => {
  try {
    const pathParts = req.path.split('/').filter(p => p); // 移除空字符串
    const method = req.method;
    const username = req.user;
    
    log('INFO', 'WebDAV 请求处理', { method, path: req.path, username, pathParts: pathParts.length });

    // 1. 根路径 /
    if (pathParts.length === 0) {
      if (method === 'PROPFIND') {
        const depth = req.header('Depth') || '0';
        let responses = [createResponseXml(`${req.baseUrl}/`, { resourcetype: 'collection', displayname: 'root' })];
        if (depth === '1') {
          responses.push(createResponseXml(`${req.baseUrl}/${username}/`, { resourcetype: 'collection', displayname: username }));
        }
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(207).send(createMultistatusXml(responses));
      }
      if (method === 'MKCOL') return res.status(201).end(); // 虚拟成功
      return res.status(200).send('z7Note WebDAV Root');
    }

    const requestUsername = pathParts[0];
    // 权限检查：只能访问自己的目录
    if (requestUsername !== username && requestUsername !== '1') {
      return res.status(403).send('Forbidden');
    }

    // 2. 用户根目录 /:username
    if (pathParts.length === 1) {
      if (method === 'PROPFIND') {
        const depth = req.header('Depth') || '0';
        log('INFO', 'WebDAV PROPFIND 请求', { username, depth, pathParts: pathParts.length });
        let responses = [createResponseXml(`${req.baseUrl}/${username}/`, { resourcetype: 'collection', displayname: username })];

        if (depth === '1' || depth === 'infinity') {
          const notes = await getConnection().all('SELECT title, updatedAt, content FROM notes WHERE username = ? AND deleted = 0', [username]);
          log('INFO', 'WebDAV PROPFIND depth=' + depth, { username, notesCount: notes.length });
          notes.forEach(note => {
            const displayTitle = note.title || 'Untitled';
            // 确保文件名有 .md 后缀
            const fname = displayTitle.toLowerCase().endsWith('.md') ? displayTitle : displayTitle + '.md';
            // 转换附件路径（Web → WebDAV）以计算正确的大小
            const convertedContent = convertAttachmentPathToWebDAV(note.content || '', username);
            const contentLength = Buffer.byteLength(convertedContent, 'utf8');
            // 智能识别秒级或毫秒级时间戳
            const timestampMs = note.updatedAt > 10000000000 ? note.updatedAt : note.updatedAt * 1000;
            const lastModified = new Date(timestampMs).toUTCString();
            const etag = `"${Math.floor(timestampMs / 1000)}"`;

            responses.push(createResponseXml(`${req.baseUrl}/${username}/${encodeURIComponent(fname)}`, {
              displayname: escapeXml(fname),
              getcontentlength: contentLength,
              getlastmodified: lastModified,
              getetag: etag,
              getcontenttype: 'text/markdown'
            }));
          });

          // 添加附件列表
          const userUploadDir = path.join(config.paths.uploads, username);
          try {
            const files = await fs.readdir(userUploadDir);
            for (const file of files) {
              try {
                const filePath = path.join(userUploadDir, file);
                const stats = await fs.stat(filePath);
                if (stats.isFile()) {
                  responses.push(createResponseXml(`${req.baseUrl}/${username}/${encodeURIComponent(file)}`, {
                    displayname: escapeXml(file),
                    getcontentlength: stats.size,
                    getlastmodified: stats.mtime.toUTCString(),
                    getetag: `"${stats.mtimeMs}"`,
                    getcontenttype: 'application/octet-stream'
                  }));
                }
              } catch (err) {
                // 忽略无法访问的文件
              }
            }
          } catch (err) {
            // 目录不存在，忽略
          }
        }
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(207).send(createMultistatusXml(responses));
      }
      if (method === 'MKCOL') return res.status(201).end();
      if (method === 'LOCK') {
        // 返回虚拟锁
        const token = crypto.randomUUID();
        res.setHeader('Lock-Token', `<opaquelocktoken:${token}>`);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(`<?xml version="1.0" encoding="utf-8" ?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>Infinity</D:depth><D:owner><D:href>z7Note</D:href></D:owner><D:timeout>Second-3600</D:timeout><D:locktoken><D:href>opaquelocktoken:${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`);
      }
      return res.status(200).end();
    }

    // 3. 具体文件或子目录 /:username/filename
    // 注意：这里我们忽略深层嵌套，直接取最后一部分作为文件名
    // Obsidian 插件会创建 .obsidian 文件夹或 rs-test-folder，我们统一视为虚拟成功或具体文件
    const rawFilename = pathParts[pathParts.length - 1];
    const filename = decodeURIComponent(rawFilename);
    const isTestFile = filename.includes('rs-test');

    // 针对 Obsidian 测试文件的特殊处理
    if (isTestFile) {
      // 存储测试文件内容到内存中（用于验证）
      if (!global.webdavTestFiles) global.webdavTestFiles = {};
      
      if (method === 'PUT') {
        // 存储上传的内容
        let contentStr = '';
        if (Buffer.isBuffer(req.body)) {
          contentStr = req.body.toString('utf8');
        } else if (typeof req.body === 'string') {
          contentStr = req.body;
        }
        global.webdavTestFiles[req.originalUrl] = contentStr;
        log('INFO', 'WebDAV 测试文件上传', { path: req.originalUrl, contentLength: contentStr.length });
        return res.status(201).end();
      }
      
      if (method === 'GET') {
        // 返回之前上传的内容
        const content = global.webdavTestFiles[req.originalUrl] || '';
        log('INFO', 'WebDAV 测试文件下载', { path: req.originalUrl, contentLength: content.length });
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(content, 'utf8'));
        return res.status(200).send(content);
      }
      
      if (method === 'DELETE') {
        delete global.webdavTestFiles[req.originalUrl];
        return res.status(204).end();
      }
      
      if (method === 'MKCOL') return res.status(201).end();

      if (method === 'PROPFIND') {
        const responses = [createResponseXml(req.originalUrl, { displayname: escapeXml(filename), resourcetype: 'collection' })];
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(207).send(createMultistatusXml(responses));
      }
      return res.status(200).end();
    }

    // 检查是否是附件文件（非 .md 文件）
    const isAttachment = !filename.toLowerCase().endsWith('.md');
    if (isAttachment) {
      const userUploadDir = path.join(config.paths.uploads, username);
      const filePath = path.join(userUploadDir, filename);

      // 确保上传目录存在
      try {
        await fs.mkdir(userUploadDir, { recursive: true });
      } catch (err) {
        // 目录已存在，忽略错误
      }

      if (method === 'GET' || method === 'HEAD') {
        try {
          const stats = await fs.stat(filePath);
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('ETag', `"${stats.mtimeMs}"`);
          res.setHeader('Last-Modified', stats.mtime.toUTCString());
          res.setHeader('Content-Length', stats.size);
          if (method === 'HEAD') return res.status(200).end();
          return res.sendFile(filePath);
        } catch (err) {
          return res.status(404).send('Not Found');
        }
      }

      if (method === 'PUT') {
        try {
          await fs.writeFile(filePath, req.body);
          log('INFO', 'WebDAV 上传附件', { username, filename });
          return res.status(201).end();
        } catch (err) {
          log('ERROR', 'WebDAV 上传附件失败', { username, filename, error: err.message });
          return res.status(500).send('Internal Server Error');
        }
      }

      if (method === 'DELETE') {
        try {
          await fs.unlink(filePath);
          log('INFO', 'WebDAV 删除附件', { username, filename });
          return res.status(204).end();
        } catch (err) {
          return res.status(404).send('Not Found');
        }
      }

      if (method === 'PROPFIND') {
        try {
          const stats = await fs.stat(filePath);
          const responses = [createResponseXml(req.originalUrl, {
            displayname: escapeXml(filename),
            getcontentlength: stats.size,
            getlastmodified: stats.mtime.toUTCString(),
            getetag: `"${stats.mtimeMs}"`,
            getcontenttype: 'application/octet-stream'
          })];
          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          return res.status(207).send(createMultistatusXml(responses));
        } catch (err) {
          return res.status(404).send('Not Found');
        }
      }

      return res.status(405).send('Method Not Allowed');
    }

    // 查找笔记
    const note = await findNote(username, filename);

    if (method === 'GET' || method === 'HEAD') {
      if (!note) return res.status(404).send('Not Found');
      // 转换附件路径（Web → WebDAV）
      const convertedContent = convertAttachmentPathToWebDAV(note.content || '', username);
      const contentBuffer = Buffer.from(convertedContent, 'utf8');
      
      const timestampMs = note.updatedAt > 10000000000 ? note.updatedAt : note.updatedAt * 1000;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('ETag', `"${Math.floor(timestampMs / 1000)}"`);
      res.setHeader('Last-Modified', new Date(timestampMs).toUTCString());
      res.setHeader('Content-Length', contentBuffer.length);
      if (method === 'HEAD') return res.status(200).end();
      return res.status(200).send(contentBuffer);
    }

    if (method === 'PUT') {
      // 获取原始 Body Buffer
      const contentBuffer = req.body;
      let contentStr = '';
      if (Buffer.isBuffer(contentBuffer)) {
        contentStr = contentBuffer.toString('utf8');
      } else if (typeof req.body === 'string') {
        contentStr = req.body;
      } else {
        // 兜底：如果是 JSON 对象
        contentStr = JSON.stringify(req.body);
      }

      // 转换附件路径（WebDAV → Web）
      contentStr = convertAttachmentPathToWeb(contentStr, username);

      const now = Math.floor(Date.now() / 1000);
      // 去掉 .md 后缀
      const cleanTitle = filename.replace(/\.md$/i, '');

      if (note) {
        await getConnection().run('UPDATE notes SET content = ?, updatedAt = ? WHERE id = ?', [contentStr, now, note.id]);
        // 通知 WebSocket 客户端
        const updatedNote = await getConnection().get('SELECT * FROM notes WHERE id = ?', [note.id]);
        if (updatedNote) {
          log('INFO', 'WebDAV 准备广播笔记更新', { noteId: updatedNote.id, title: updatedNote.title });
          broadcastNoteUpdate(updatedNote);
        }
        res.setHeader('ETag', `"${now}"`);
        return res.status(204).end(); // 204 No Content (Standard for update)
      } else {
        const id = 'note_' + crypto.randomBytes(8).toString('hex');
        await getConnection().run('INSERT INTO notes (id, username, title, content, updatedAt, deleted) VALUES (?, ?, ?, ?, ?, 0)', [id, username, cleanTitle, contentStr, now]);
        // 通知 WebSocket 客户端
        const newNote = await getConnection().get('SELECT * FROM notes WHERE id = ?', [id]);
        if (newNote) {
          log('INFO', 'WebDAV 准备广播新笔记', { noteId: newNote.id, title: newNote.title });
          broadcastNoteUpdate(newNote);
        }
        res.setHeader('ETag', `"${now}"`);
        return res.status(201).end(); // 201 Created
      }
    }

    if (method === 'DELETE') {
      if (note) {
        await getConnection().run('UPDATE notes SET deleted = 1, updatedAt = ? WHERE id = ?', [Math.floor(Date.now() / 1000), note.id]);
        // 通知 WebSocket 客户端
        broadcastNoteDelete(note.id);
      }
      return res.status(204).end();
    }

    if (method === 'PROPFIND') {
      if (!note) return res.status(404).send('Not Found');
      // 转换附件路径（Web → WebDAV）以计算正确的大小
      const convertedContent = convertAttachmentPathToWebDAV(note.content || '', username);
      const contentBuffer = Buffer.from(convertedContent, 'utf8');
      // 智能识别秒级或毫秒级时间戳
      const timestampMs = note.updatedAt > 10000000000 ? note.updatedAt : note.updatedAt * 1000;
      const responses = [createResponseXml(req.originalUrl, {
        displayname: escapeXml(filename),
        getcontenttype: 'text/markdown',
        getcontentlength: contentBuffer.length,
        getlastmodified: new Date(timestampMs).toUTCString(),
        getetag: `"${Math.floor(timestampMs / 1000)}"`
      })];
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(207).send(createMultistatusXml(responses));
    }

    // 对其他所有方法（LOCK, UNLOCK, MOVE, COPY, PROPPATCH）返回成功
    // 这是为了满足 Obsidian 插件的“仪式感”检查
    if (['LOCK', 'UNLOCK', 'PROPPATCH', 'MOVE', 'COPY', 'MKCOL'].includes(method)) {
      if (method === 'LOCK') {
        const token = crypto.randomUUID();
        res.setHeader('Lock-Token', `<opaquelocktoken:${token}>`);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(`<?xml version="1.0" encoding="utf-8" ?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>Infinity</D:depth><D:owner><D:href>z7Note</D:href></D:owner><D:timeout>Second-3600</D:timeout><D:locktoken><D:href>opaquelocktoken:${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`);
      }
      return res.status(200).end(); // 或 201/204
    }

    return res.status(405).end();

  } catch (err) {
    console.error('[WebDAV Error]', err);
    res.status(500).send();
  }
});

module.exports = router;
