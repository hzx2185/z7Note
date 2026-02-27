/**
 * CardDAV 服务器路由
 * 实现 RFC 6352 CardDAV 协议
 */

const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const VCardGenerator = require('../utils/vCardGenerator');
const VCardParser = require('../utils/vCardParser');
const { basicAuthMiddleware } = require('../middleware/basicAuth');

const router = express.Router();

// 生成唯一ID
function generateId() {
  return 'contact_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// 全局中间件，用于日志记录
router.use((req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  console.log(`[CardDAV] ${req.method} ${req.path} - User-Agent: ${userAgent}`);
  const originalSend = res.send;
  res.send = function(data) {
    console.log(`[CardDAV] Response: ${res.statusCode} for ${req.method} ${req.path}`);
    return originalSend.call(this, data);
  };
  next();
});

// OPTIONS - 宣告服务器支持的方法
router.options('*', (req, res) => {
  res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT, MKCOL, PROPPATCH');
  res.setHeader('DAV', '1, 2, 3, addressbook, access-control');
  res.setHeader('MS-Author-Via', 'DAV');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).end();
});

// PROPFIND / - 初始服务发现
router.propfind('/', basicAuthMiddleware, async (req, res) => {
  try {
    const username = req.user;
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/carddav/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal>
          <D:href>/carddav/principals/${username}/</D:href>
        </D:current-user-principal>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', 'CardDAV根路径 PROPFIND 失败', { error: error.message });
    res.status(500).send();
  }
});

// PROPFIND /principals/:username/ - Principal 发现
router.propfind('/principals/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/carddav/principals/${username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:principal/></D:resourcetype>
        <D:displayname>${username}</D:displayname>
        <D:principal-URL>
          <D:href>/carddav/principals/${username}/</D:href>
        </D:principal-URL>
        <C:addressbook-home-set>
          <D:href>/carddav/${username}/</D:href>
        </C:addressbook-home-set>
        <D:current-user-privilege-set>
          <D:privilege><D:all/></D:privilege>
        </D:current-user-privilege-set>
        <D:supported-report-set>
          <D:report-set-item>
            <D:report><D:expand-property/></D:report>
          </D:report-set-item>
          <D:report-set-item>
            <D:report><D:principal-property-search/></D:report>
          </D:report-set-item>
          <D:report-set-item>
            <D:report><D:principal-search-property-set/></D:report>
          </D:report-set-item>
        </D:supported-report-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', 'CardDAV Principals PROPFIND 失败', { error: error.message });
    res.status(500).send();
  }
});

// PROPFIND /:username/ - 地址簿主目录发现
router.propfind('/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user) return res.status(403).send();

    const depth = req.header('Depth') || '0';
    let ctag = 0;
    let itemsXml = '';

    if (depth === '1') {
        const [notes, contacts] = await Promise.all([
          getConnection().all('SELECT id, title, updatedAt FROM notes WHERE username = ? AND deleted = 0', [username]),
          getConnection().all('SELECT id, fn, updatedAt FROM contacts WHERE username = ?', [username])
        ]);
      
      // 计算最新的 updatedAt 作为 ctag
      if (contacts.length > 0) {
        ctag = Math.max(...contacts.map(c => c.updatedAt || 0));
      }
      
      log('INFO', 'CardDAV PROPFIND depth=1', {
        username,
        contactsCount: contacts.length
      });
      
      const allItems = [...notes, ...contacts];
        allItems.forEach(item => {
        itemsXml += `
    <D:response>
      <D:href>/carddav/${username}/${item.id}.vcf</D:href>
      <D:propstat>
        <D:prop>
          <D:displayname>${item.title || item.fn || 'Unnamed'}</D:displayname>
          <D:getetag>"${item.updatedAt}"</D:getetag>
          <D:getcontenttype>text/vcard; charset=utf-8</D:getcontenttype>
          <D:resourcetype/>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`;
      });
    }

    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/carddav/${username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:addressbook/></D:resourcetype>
        <D:displayname>${username}</D:displayname>
        <C:supported-address-data>
          <C:address-data-type content-type="text/vcard" version="3.0"/>
        </C:supported-address-data>
        <D:getctag>"${ctag}"</D:getctag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  ${itemsXml}
</D:multistatus>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', 'CardDAV PROPFIND /:username/ 失败', { error: error.message });
    res.status(500).send();
  }
});

// MKCOL /:username/ - 创建地址簿
router.mkcol('/:username/', basicAuthMiddleware, (req, res) => {
  if (req.params.username !== req.user) return res.status(403).send();
  log('INFO', 'CardDAV MKCOL 请求 (虚拟成功)', { username: req.params.username });
  res.status(201).send();
});

// PROPPATCH /:username/ - 更新地址簿属性
router.proppatch('/:username/', basicAuthMiddleware, (req, res) => {
  if (req.params.username !== req.user) return res.status(403).send();
  log('INFO', 'CardDAV PROPPATCH 请求 (虚拟成功)', { username: req.params.username });
  const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/carddav/${req.params.username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.status(207).send(xml);
});

// REPORT /:username/ - 获取联系人内容
router.report('/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user) return res.status(403).send();

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        log('INFO', 'CardDAV REPORT 请求', { username, body: body.substring(0, 500) });

        // 解析请求的 href
        const hrefMatches = body.match(/<D:href>([^<]+)<\/D:href>/g);
        const requestedHrefs = hrefMatches 
          ? hrefMatches.map(m => m.replace(/<\/?D:href>/g, ''))
          : [];

        // 获取请求的联系人
        let contacts;
        if (requestedHrefs.length > 0) {
          // 提取 ID
          const ids = requestedHrefs
            .map(href => {
              const match = href.match(/\/([^\/]+)\.vcf$/);
              return match ? match[1] : null;
            })
            .filter(id => id);

          if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            contacts = await getConnection().all(
              `SELECT * FROM contacts WHERE username = ? AND id IN (${placeholders})`,
              [username, ...ids]
            );
          } else {
            contacts = [];
          }
        } else {
          // 获取所有联系人
          contacts = await getConnection().all(
            'SELECT * FROM contacts WHERE username = ?',
            [username]
          );
        }

        // 生成响应
        let responsesXml = '';
        contacts.forEach(contact => {
          const vcard = VCardGenerator.contactToVCard(contact);
          responsesXml += `
  <D:response>
    <D:href>/carddav/${username}/${contact.id}.vcf</D:href>
    <D:propstat>
      <D:prop>
        <C:address-data>${escapeXml(vcard)}</C:address-data>
        <D:getetag>"${contact.updatedAt}"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
          log('INFO', 'CardDAV REPORT 返回VCard内容', {
            username,
            contactId: contact.id,
            contactFn: contact.fn
          });
        });

        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
${responsesXml}
</D:multistatus>`;

        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.status(207).send(xml);
      } catch (error) {
        log('ERROR', 'CardDAV REPORT 处理失败', { error: error.message });
        res.status(500).send();
      }
    });
  } catch (error) {
    log('ERROR', 'CardDAV REPORT 失败', { error: error.message });
    res.status(500).send();
  }
});

// GET /:username/:id.vcf - 获取单个联系人
router.get('/:username/:id.vcf', basicAuthMiddleware, async (req, res) => {
  try {
    const { username, id } = req.params;
    if (username !== req.user) return res.status(403).send();

    const contact = await getConnection().get(
      'SELECT * FROM contacts WHERE id = ? AND username = ?',
      [id, username]
    );

    if (!contact) {
      return res.status(404).send();
    }

    const vcard = VCardGenerator.contactToVCard(contact);
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('ETag', `"${contact.updatedAt}"`);
    res.send(vcard);
  } catch (error) {
    log('ERROR', 'CardDAV GET 联系人失败', { error: error.message });
    res.status(500).send();
  }
});

// PUT /:username/:id.vcf - 创建或更新联系人
router.put('/:username/:id.vcf', basicAuthMiddleware, async (req, res) => {
  try {
    const { username, id } = req.params;
    if (username !== req.user) return res.status(403).send();

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        log('INFO', 'CardDAV PUT 请求', { username, id, bodyLength: body.length });

        // 解析 vCard
        const contactData = VCardParser.parse(body);
        const now = Math.floor(Date.now() / 1000);

        // 检查是否存在
        const existing = await getConnection().get(
          'SELECT id FROM contacts WHERE id = ? AND username = ?',
          [id, username]
        );

        if (existing) {
          // 更新
          await getConnection().run(
            `UPDATE contacts SET 
              fn = ?, n_family = ?, n_given = ?, n_middle = ?, n_prefix = ?, n_suffix = ?,
              tel = ?, email = ?, adr = ?, org = ?, title = ?, url = ?, photo = ?, note = ?,
              bday = ?, nickname = ?, vcard = ?, updatedAt = ?
            WHERE id = ? AND username = ?`,
            [
              contactData.fn || '',
              contactData.n_family || '',
              contactData.n_given || '',
              contactData.n_middle || '',
              contactData.n_prefix || '',
              contactData.n_suffix || '',
              contactData.tel || null,
              contactData.email || null,
              contactData.adr || null,
              contactData.org || '',
              contactData.title || '',
              contactData.url || '',
              contactData.photo || '',
              contactData.note || '',
              contactData.bday || '',
              contactData.nickname || '',
              body,
              now,
              id,
              username
            ]
          );
          log('INFO', 'CardDAV 联系人已更新', { username, id, fn: contactData.fn });
        } else {
          // 创建
          const uid = contactData.uid || id;
          await getConnection().run(
            `INSERT INTO contacts (
              id, username, uid, fn, n_family, n_given, n_middle, n_prefix, n_suffix,
              tel, email, adr, org, title, url, photo, note, bday, nickname, vcard,
              createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              username,
              uid,
              contactData.fn || '',
              contactData.n_family || '',
              contactData.n_given || '',
              contactData.n_middle || '',
              contactData.n_prefix || '',
              contactData.n_suffix || '',
              contactData.tel || null,
              contactData.email || null,
              contactData.adr || null,
              contactData.org || '',
              contactData.title || '',
              contactData.url || '',
              contactData.photo || '',
              contactData.note || '',
              contactData.bday || '',
              contactData.nickname || '',
              body,
              now,
              now
            ]
          );
          log('INFO', 'CardDAV 联系人已创建', { username, id, fn: contactData.fn });
        }

        res.setHeader('ETag', `"${now}"`);
        res.status(existing ? 204 : 201).send();
      } catch (error) {
        log('ERROR', 'CardDAV PUT 处理失败', { error: error.message });
        res.status(500).send();
      }
    });
  } catch (error) {
    log('ERROR', 'CardDAV PUT 失败', { error: error.message });
    res.status(500).send();
  }
});

// DELETE /:username/:id.vcf - 删除联系人
router.delete('/:username/:id.vcf', basicAuthMiddleware, async (req, res) => {
  try {
    const { username, id } = req.params;
    if (username !== req.user) return res.status(403).send();

    const result = await getConnection().run(
      'DELETE FROM contacts WHERE id = ? AND username = ?',
      [id, username]
    );

    if (result.changes === 0) {
      return res.status(404).send();
    }

    log('INFO', 'CardDAV 联系人已删除', { username, id });
    res.status(204).send();
  } catch (error) {
    log('ERROR', 'CardDAV DELETE 失败', { error: error.message });
    res.status(500).send();
  }
});

// 辅助函数：转义 XML
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;
