/**
 * WebDAV 服务器路由
 * 实现 RFC 4918 WebDAV 协议
 */

const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const { basicAuthMiddleware } = require('../middleware/basicAuth');
const crypto = require('crypto');

const router = express.Router();

// 存储虚拟文件
const virtualFiles = new Map();

// 全局中间件：日志和 URL 规范化
router.use((req, res, next) => {
  if (req.url.includes('//')) {
    req.url = req.url.replace(/\/+/g, '/');
  }
  next();
});

// OPTIONS - 宣告支持的方法
router.options('*', (req, res) => {
  res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE');
  res.setHeader('DAV', '1, 2');
  res.setHeader('MS-Author-Via', 'DAV');
  res.status(200).end();
});

// --- 基础信息 ---
router.get('/info.json', basicAuthMiddleware, (req, res) => res.json({ name: 'z7Note WebDAV', version: '1.1.1' }));

// --- 根路径发现 ---
router.propfind('/', basicAuthMiddleware, async (req, res) => {
  const username = req.user;
  const depth = req.header('Depth') || '0';
  let itemsXml = '';
  if (depth === '1') {
    itemsXml = `
    <D:response>
      <D:href>${req.baseUrl}/${username}/</D:href>
      <D:propstat>
        <D:prop>
          <D:displayname>${username}</D:displayname>
          <D:resourcetype><D:collection/></D:resourcetype>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`;
  }
  const xml = `<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:">
    <D:response><D:href>${req.baseUrl}/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>${itemsXml}</D:multistatus>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.status(207).send(xml);
});

// --- 用户目录列表 ---
router.propfind('/:username/', basicAuthMiddleware, async (req, res) => {
  const { username } = req.params;
  if (username !== req.user && username !== '1') return res.status(403).send();
  const actualUsername = req.user;

  const depth = req.header('Depth') || '0';
  const notes = await getConnection().all('SELECT id, title, updatedAt, content FROM notes WHERE username = ? AND deleted = 0', [actualUsername]);

  let itemsXml = '';
  if (depth === '1') {
    notes.forEach(note => {
      const displayTitle = note.title || '未命名';
      // 统一加上 .md 后缀供 WebDAV 识别
      const filename = displayTitle.toLowerCase().endsWith('.md') ? displayTitle : displayTitle + '.md';
      const encodedFilename = encodeURIComponent(filename);
      
      itemsXml += `
    <D:response>
      <D:href>${req.baseUrl}/${username}/${encodedFilename}</D:href>
      <D:propstat>
        <D:prop>
          <D:displayname>${escapeXml(filename)}</D:displayname>
          <D:getcontenttype>text/markdown</D:getcontenttype>
          <D:getcontentlength>${Buffer.byteLength(note.content || '', 'utf8')}</D:getcontentlength>
          <D:resourcetype/>
          <D:getlastmodified>${new Date(note.updatedAt).toUTCString()}</D:getlastmodified>
          <D:getetag>"${note.updatedAt}"</D:getetag>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`;
    });
  }

  const xml = `<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:">
    <D:response><D:href>${req.baseUrl}/${username}/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:displayname>${actualUsername}</D:displayname></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>${itemsXml}</D:multistatus>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.status(207).send(xml);
});

// --- 具体文件操作 ---
router.all('/:username/:filename(*.(md|json))', basicAuthMiddleware, async (req, res) => {
  const { username, filename } = req.params;
  if (username !== req.user && username !== '1') return res.status(403).send();
  
  const decodedFilename = decodeURIComponent(filename);
  const note = await findNoteByFilename(req.user, decodedFilename);
  const method = req.method;

  if (method === 'GET' || method === 'HEAD') {
    if (!note) return res.status(404).send();
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('ETag', `"${note.updatedAt}"`);
    res.setHeader('Last-Modified', new Date(note.updatedAt).toUTCString());
    res.setHeader('Content-Length', Buffer.byteLength(note.content || '', 'utf8'));
    return (method === 'HEAD') ? res.status(200).end() : res.send(note.content || '');
  }

  if (method === 'PUT') {
    const content = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const cleanTitle = decodedFilename.replace(/\.md$/i, '');
    const now = Date.now();
    if (note) {
      await getConnection().run('UPDATE notes SET content = ?, updatedAt = ? WHERE id = ?', [content, now, note.id]);
      res.setHeader('ETag', `"${now}"`);
      return res.status(204).end();
    } else {
      const id = 'note_' + crypto.randomBytes(8).toString('hex');
      await getConnection().run('INSERT INTO notes (id, username, title, content, updatedAt, deleted) VALUES (?, ?, ?, ?, ?, 0)', [id, req.user, cleanTitle, content, now]);
      res.setHeader('ETag', `"${now}"`);
      return res.status(201).end();
    }
  }

  if (method === 'PROPFIND') {
    if (!note) return res.status(404).send();
    const xml = `<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${req.originalUrl}</D:href><D:propstat><D:prop><D:displayname>${escapeXml(decodedFilename)}</D:displayname><D:resourcetype/><D:getcontenttype>text/markdown</D:getcontenttype><D:getcontentlength>${Buffer.byteLength(note.content || '', 'utf8')}</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(207).send(xml);
  }

  if (method === 'DELETE') {
    if (!note) return res.status(404).end();
    await getConnection().run('UPDATE notes SET deleted = 1, updatedAt = ? WHERE id = ?', [Date.now(), note.id]);
    return res.status(204).end();
  }
  res.status(405).end();
});

// --- 通配符/虚拟目录 (放在最后) ---
router.all('/:username/*', basicAuthMiddleware, async (req, res) => {
  if (req.params.username !== req.user && req.params.username !== '1') return res.status(403).send();
  const method = req.method;
  if (method === 'MKCOL') return res.status(201).end();
  if (method === 'PROPFIND') {
    const xml = `<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${req.originalUrl}</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:displayname>Folder</D:displayname></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(207).send(xml);
  }
  res.status(404).end();
});

// 辅助函数
async function findNoteByFilename(username, filename) {
  const db = getConnection();
  const titleWithoutMd = filename.replace(/\.md$/i, '');
  
  // 1. 尝试完全匹配（标题里可能自带 .md）
  let note = await db.get('SELECT * FROM notes WHERE username = ? AND title = ? AND deleted = 0', [username, filename]);
  if (note) return note;
  
  // 2. 尝试不带 .md 的匹配
  note = await db.get('SELECT * FROM notes WHERE username = ? AND title = ? AND deleted = 0', [username, titleWithoutMd]);
  if (note) return note;

  // 3. 处理下划线/斜杠兼容性
  const titleWithSlash = titleWithoutMd.replace(/_/g, '/');
  return await db.get('SELECT * FROM notes WHERE username = ? AND title = ? AND deleted = 0', [username, titleWithSlash]);
}

function escapeXml(text) {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = router;
