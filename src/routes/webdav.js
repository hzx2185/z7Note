/**
 * WebDAV 服务器路由
 * 实现 RFC 4918 WebDAV 协议
 * 用于同步笔记文件到 iOS "文件" App 或第三方笔记应用
 */

const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const { basicAuthMiddleware } = require('../middleware/basicAuth');

const router = express.Router();

// 全局中间件，用于日志记录
router.use((req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  console.log(`[WebDAV] ${req.method} ${req.path} - User-Agent: ${userAgent}`);
  const originalSend = res.send;
  res.send = function(data) {
    console.log(`[WebDAV] Response: ${res.statusCode} for ${req.method} ${req.path}`);
    return originalSend.call(this, data);
  };
  next();
});

// OPTIONS - 宣告服务器支持的方法
router.options('*', (req, res) => {
  res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE');
  res.setHeader('DAV', '1, 2');
  res.setHeader('MS-Author-Via', 'DAV');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).end();
});

// PROPFIND / - 初始服务发现
router.propfind('/', basicAuthMiddleware, async (req, res) => {
  try {
    const username = req.user;
    const depth = req.header('Depth') || '0';
    
    // 解析请求的 XML body，获取需要返回的属性
    let requestedProps = [];
    if (req.body) {
      try {
        const propMatch = req.body.match(/<D:prop[^>]*>([\s\S]*?)<\/D:prop>/i);
        if (propMatch) {
          const propContent = propMatch[1];
          const propNames = propContent.match(/<D:([a-z-]+)>/gi);
          if (propNames) {
            requestedProps = propNames.map(p => p.replace(/<\/?D:/gi, '').replace(/>/g, ''));
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    
    let propXml = '';
    
    // 根据请求的属性返回相应内容
    if (requestedProps.includes('current-user-principal') || requestedProps.length === 0) {
      propXml += `
          <D:current-user-principal>
            <D:href>/webdav/${username}/</D:href>
          </D:current-user-principal>`;
    }
    
    if (requestedProps.includes('resourcetype') || requestedProps.length === 0) {
      propXml += `
          <D:resourcetype><D:collection/></D:resourcetype>`;
    }
    
    if (requestedProps.includes('displayname') || requestedProps.length === 0) {
      propXml += `
          <D:displayname>z7Note</D:displayname>`;
    }

    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/webdav/</D:href>
    <D:propstat>
      <D:prop>${propXml}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', 'WebDAV 根路径 PROPFIND 失败', { error: error.message });
    res.status(500).send();
  }
});

// PROPFIND /:username - 用户目录（不带斜杠）
router.propfind('/:username', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user) return res.status(403).send();
    
    // 重定向到带斜杠的路径
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/webdav/${username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:displayname>${username}</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', 'WebDAV PROPFIND 用户目录失败', { error: error.message });
    res.status(500).send();
  }
});

// PROPFIND /:username/ - 获取笔记列表
router.propfind('/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user) return res.status(403).send();

    const depth = req.header('Depth') || '0';
    
    // 获取用户的所有笔记
    const notes = await getConnection().all(
      'SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND deleted = 0',
      [username]
    );

    let ctag = 0;
    let itemsXml = '';

    if (notes.length > 0) {
      ctag = Math.max(...notes.map(n => n.updatedAt || 0));
    }

    if (depth === '1') {
      notes.forEach(note => {
        const filename = sanitizeFilename(note.title || note.id) + '.md';
        const contentLength = Buffer.byteLength(note.content || '', 'utf8');
        itemsXml += `
    <D:response>
      <D:href>/webdav/${username}/${filename}</D:href>
      <D:propstat>
        <D:prop>
          <D:displayname>${escapeXml(note.title || '未命名')}</D:displayname>
          <D:getetag>"${note.updatedAt}"</D:getetag>
          <D:getcontenttype>text/markdown; charset=utf-8</D:getcontenttype>
          <D:resourcetype/>
          <D:getcontentlength>${contentLength}</D:getcontentlength>
          <D:getlastmodified>${new Date(note.updatedAt).toUTCString()}</D:getlastmodified>
          <D:creationdate>${new Date(note.updatedAt).toISOString()}</D:creationdate>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`;
      });
    }

    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/webdav/${username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:displayname>${username} 的笔记</D:displayname>
        <D:getctag>"${ctag}"</D:getctag>
        <D:getlastmodified>${new Date(ctag).toUTCString()}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  ${itemsXml}
</D:multistatus>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', 'WebDAV PROPFIND /:username/ 失败', { error: error.message });
    res.status(500).send();
  }
});

// PROPFIND /:username/:filename - 获取单个文件属性
router.propfind('/:username/:filename', basicAuthMiddleware, async (req, res) => {
  try {
    const { username, filename } = req.params;
    if (username !== req.user) return res.status(403).send();

    // 解析文件名获取笔记 ID 或标题
    const note = await findNoteByFilename(username, filename);
    
    if (!note) {
      res.status(404).send();
      return;
    }

    const contentLength = Buffer.byteLength(note.content || '', 'utf8');
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/webdav/${username}/${filename}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(note.title || '未命名')}</D:displayname>
        <D:getetag>"${note.updatedAt}"</D:getetag>
        <D:getcontenttype>text/markdown; charset=utf-8</D:getcontenttype>
        <D:resourcetype/>
        <D:getcontentlength>${contentLength}</D:getcontentlength>
        <D:getlastmodified>${new Date(note.updatedAt).toUTCString()}</D:getlastmodified>
        <D:creationdate>${new Date(note.updatedAt).toISOString()}</D:creationdate>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', 'WebDAV PROPFIND 文件失败', { error: error.message });
    res.status(500).send();
  }
});

// GET /:username/:filename - 下载笔记文件
router.get('/:username/:filename', basicAuthMiddleware, async (req, res) => {
  try {
    const { username, filename } = req.params;
    if (username !== req.user) return res.status(403).send();

    const note = await findNoteByFilename(username, filename);
    
    if (!note) {
      res.status(404).send();
      return;
    }

    // 设置响应头
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('ETag', `"${note.updatedAt}"`);
    res.setHeader('Last-Modified', new Date(note.updatedAt).toUTCString());
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    
    // 返回 Markdown 内容
    res.send(note.content || '');
  } catch (error) {
    log('ERROR', 'WebDAV GET 文件失败', { error: error.message });
    res.status(500).send();
  }
});

// HEAD /:username/:filename - 获取文件信息（不返回内容）
router.head('/:username/:filename', basicAuthMiddleware, async (req, res) => {
  try {
    const { username, filename } = req.params;
    if (username !== req.user) return res.status(403).send();

    const note = await findNoteByFilename(username, filename);
    
    if (!note) {
      res.status(404).end();
      return;
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('ETag', `"${note.updatedAt}"`);
    res.setHeader('Last-Modified', new Date(note.updatedAt).toUTCString());
    res.setHeader('Content-Length', Buffer.byteLength(note.content || '', 'utf8'));
    res.status(200).end();
  } catch (error) {
    log('ERROR', 'WebDAV HEAD 文件失败', { error: error.message });
    res.status(500).end();
  }
});

// PUT /:username/:filename - 上传/更新笔记文件
router.put('/:username/:filename', basicAuthMiddleware, async (req, res) => {
  try {
    const { username, filename } = req.params;
    if (username !== req.user) return res.status(403).send();

    // 获取请求体内容
    let content = '';
    if (Buffer.isBuffer(req.body)) {
      content = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      content = req.body;
    } else {
      content = JSON.stringify(req.body);
    }

    // 从文件名提取标题（去掉 .md 后缀）
    const title = filename.replace(/\.md$/i, '');

    // 检查是否已存在同名笔记
    const existingNote = await findNoteByFilename(username, filename);

    if (existingNote) {
      // 更新现有笔记
      const now = Date.now();
      await getConnection().run(
        'UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ?',
        [title, content, now, existingNote.id]
      );
      
      res.setHeader('ETag', `"${now}"`);
      res.status(204).end();
    } else {
      // 创建新笔记
      const id = 'note_' + require('crypto').randomBytes(8).toString('hex');
      const now = Date.now();
      
      // 检查用户配额
      const user = await getConnection().get('SELECT noteLimit FROM users WHERE username = ?', [username]);
      const noteCount = await getConnection().get(
        'SELECT COUNT(*) as count FROM notes WHERE username = ? AND deleted = 0',
        [username]
      );
      
      if (user && noteCount.count >= user.noteLimit) {
        res.status(507).send('Insufficient Storage');
        return;
      }

      await getConnection().run(
        'INSERT INTO notes (id, username, title, content, updatedAt, deleted) VALUES (?, ?, ?, ?, ?, 0)',
        [id, username, title, content, now]
      );
      
      res.setHeader('ETag', `"${now}"`);
      res.status(201).end();
    }
  } catch (error) {
    log('ERROR', 'WebDAV PUT 文件失败', { error: error.message });
    res.status(500).send();
  }
});

// DELETE /:username/:filename - 删除笔记文件
router.delete('/:username/:filename', basicAuthMiddleware, async (req, res) => {
  try {
    const { username, filename } = req.params;
    if (username !== req.user) return res.status(403).send();

    const note = await findNoteByFilename(username, filename);
    
    if (!note) {
      res.status(404).end();
      return;
    }

    // 软删除笔记
    await getConnection().run(
      'UPDATE notes SET deleted = 1, updatedAt = ? WHERE id = ?',
      [Date.now(), note.id]
    );
    
    res.status(204).end();
  } catch (error) {
    log('ERROR', 'WebDAV DELETE 文件失败', { error: error.message });
    res.status(500).send();
  }
});

// MKCOL /:username/ - 创建目录（虚拟成功）
router.mkcol('/:username/', basicAuthMiddleware, (req, res) => {
  if (req.params.username !== req.user) return res.status(403).send();
  res.status(201).end();
});

// MKCOL /:username - 创建目录（虚拟成功）
router.mkcol('/:username', basicAuthMiddleware, (req, res) => {
  if (req.params.username !== req.user) return res.status(403).send();
  res.status(201).end();
});

// MKCOL / - 创建根目录（虚拟成功）
router.mkcol('/', basicAuthMiddleware, (req, res) => {
  res.status(201).end();
});

// GET /:username/ - 获取目录信息
router.get('/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user) return res.status(403).send();
    
    // 返回目录的 HTML 列表（用于浏览器访问）
    const notes = await getConnection().all(
      'SELECT id, title, updatedAt FROM notes WHERE username = ? AND deleted = 0',
      [username]
    );
    
    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${username} 的笔记</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; }
    h1 { color: #333; }
    ul { list-style: none; padding: 0; }
    li { padding: 8px 0; border-bottom: 1px solid #eee; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${username} 的笔记</h1>
  <ul>`;
    
    notes.forEach(note => {
      const filename = sanitizeFilename(note.title || note.id) + '.md';
      html += `\n    <li><a href="/webdav/${username}/${filename}">${escapeXml(note.title || '未命名')}</a></li>`;
    });
    
    html += `
  </ul>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    log('ERROR', 'WebDAV GET 目录失败', { error: error.message });
    res.status(500).send();
  }
});

// 辅助函数：根据文件名查找笔记
async function findNoteByFilename(username, filename) {
  const db = getConnection();
  
  // 去掉 .md 后缀
  const title = filename.replace(/\.md$/i, '');
  
  // 先尝试按标题查找
  let note = await db.get(
    'SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND title = ? AND deleted = 0',
    [username, title]
  );
  
  if (note) return note;
  
  // 如果标题查找失败，尝试按 ID 查找（文件名可能是 ID.md）
  const idMatch = filename.match(/^(note_[a-f0-9]+)\.md$/i);
  if (idMatch) {
    note = await db.get(
      'SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND id = ? AND deleted = 0',
      [username, idMatch[1]]
    );
  }
  
  return note;
}

// 辅助函数：清理文件名
function sanitizeFilename(name) {
  // 移除不允许的字符
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

// 辅助函数：转义 XML 特殊字符
function escapeXml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;
