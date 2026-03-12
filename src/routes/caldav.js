/**
 * CalDAV 服务器路由 - 兼容性极致修复版 (V2 - 性能与删除优化)
 */

const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const ICalGenerator = require('../utils/icalGenerator');
const ICalParser = require('../utils/icalParser');
const { basicAuthMiddleware } = require('../middleware/basicAuth');
const { broadcast } = require('./ws');
const { scopeExternalCalendarId, toClientCalendarId } = require('../utils/calendarIds');

const router = express.Router();

/**
 * 优化：防抖广播
 */
const debounceBroadcasts = new Map();
function debouncedBroadcast(username) {
    if (debounceBroadcasts.has(username)) return;
    broadcast('calendar_update', { username, type: 'sync' }, { targetUsername: username });
    const timer = setTimeout(() => {
        debounceBroadcasts.delete(username);
        broadcast('calendar_update', { username, type: 'sync' }, { targetUsername: username });
    }, 2000);
    debounceBroadcasts.set(username, timer);
}

// XML 转义
function esc(str) {
    if (!str) return '';
    return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// URL 编码
function urlEsc(str) {
    return encodeURIComponent(str).replace(/%2F/g, '/');
}

router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, PROPPATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Depth, If-Match, If-None-Match, X-Requested-With');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, DAV, Allow');
  next();
});

// OPTIONS
router.options('*', (req, res) => {
  res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, PROPPATCH');
  res.setHeader('DAV', '1, 2, 3, calendar-access, calendar-schedule, calendar-proxy, sync-collection');
  res.status(200).end();
});

// PROPFIND /
router.propfind('/', basicAuthMiddleware, async (req, res) => {
  const username = req.user;
  const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/caldav/</D:href><D:propstat><D:prop><D:current-user-principal><D:href>/caldav/principals/${urlEsc(username)}/</D:href></D:current-user-principal><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.status(207).send(xml);
});

// PROPFIND /principals/:username/
router.propfind('/principals/:username/', basicAuthMiddleware, async (req, res) => {
  const { username } = req.params;
  if (username !== req.user) return res.status(403).send();
  const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/caldav/principals/${urlEsc(username)}/</D:href><D:propstat><D:prop><D:resourcetype><D:principal/></D:resourcetype><D:displayname>${esc(username)}</D:displayname><D:principal-URL><D:href>/caldav/principals/${urlEsc(username)}/</D:href></D:principal-URL><C:calendar-home-set><D:href>/caldav/${urlEsc(username)}/</D:href></C:calendar-home-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.status(207).send(xml);
});

// PROPFIND /:username/ (日历集合)
router.propfind('/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user) return res.status(403).send();
    const depth = req.header('Depth') || '0';

    const lastUpdate = await getConnection().get(`
      SELECT MAX(ts) as maxTs FROM (
        SELECT updatedAt as ts FROM events WHERE username = ?
        UNION ALL
        SELECT updatedAt as ts FROM todos WHERE username = ?
        UNION ALL
        SELECT deletedAt as ts FROM deleted_items WHERE username = ?
      )
    `, [username, username, username]);
    
    const ctag = lastUpdate && lastUpdate.maxTs ? Math.floor(lastUpdate.maxTs) : 1;
    let itemsXml = '';

    if (depth === '1') {
      const items = await getConnection().all(`SELECT DISTINCT id, updatedAt FROM (SELECT id, updatedAt FROM events WHERE username = ? UNION ALL SELECT id, updatedAt FROM todos WHERE username = ?) ORDER BY updatedAt DESC`, [username, username]);
      items.forEach(item => {
        const clientId = toClientCalendarId(username, item.id);
        itemsXml += `<D:response><D:href>/caldav/${urlEsc(username)}/${urlEsc(clientId)}.ics</D:href><D:propstat><D:prop><D:getetag>"${item.updatedAt}"</D:getetag><D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
      });
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/"><D:response><D:href>/caldav/${urlEsc(username)}/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>${esc(username)}</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set><CS:getctag>"${ctag}"</CS:getctag><D:sync-token>${ctag}</D:sync-token><D:supported-report-set><D:report-set-item><D:report><C:calendar-multiget/></D:report></D:report-set-item><D:report-set-item><D:report><C:calendar-query/></D:report></D:report-set-item><D:report-set-item><D:report><D:sync-collection/></D:report></D:report-set-item></D:supported-report-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>${itemsXml}</D:multistatus>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) { res.status(500).send(); }
});

// PROPPATCH
router.proppatch('/:username/', basicAuthMiddleware, async (req, res) => {
  const { username } = req.params;
  if (username !== req.user) return res.status(403).send();
  const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/caldav/${urlEsc(username)}/</D:href><D:propstat><D:prop><D:calendar-color xmlns:apple="http://apple.com/ns/ical/"/><D:displayname/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.status(207).send(xml);
});

// REPORT
router.report('/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user) return res.status(403).send();
    const body = (typeof req.body === 'string' ? req.body : '') || '';
    let items = [], responses = '', newToken = null, seenHrefs = new Set();

    if (body.includes('calendar-multiget')) {
      const ids = [];
      const hrefs = body.match(/<[a-zA-Z0-9_:]*href[^>]*>([^<]+)/g) || [];
      hrefs.forEach(h => {
          const match = h.match(/\/([^\/]+)\.ics$/);
          if (match) {
            try {
              const rawId = decodeURIComponent(match[1]);
              ids.push(rawId, scopeExternalCalendarId(username, rawId));
            } catch (e) {
              ids.push(match[1], scopeExternalCalendarId(username, match[1]));
            }
          }
      });
      if (ids.length > 0) {
          const CHUNK = 100;
          for (let i = 0; i < ids.length; i += CHUNK) {
              const chunk = ids.slice(i, i + CHUNK);
              const p = chunk.map(() => '?').join(',');
              const [ev, td] = await Promise.all([
                  getConnection().all(`SELECT *, 'event' as type FROM events WHERE username = ? AND id IN (${p})`, [username, ...chunk]),
                  getConnection().all(`SELECT *, 'todo' as type FROM todos WHERE username = ? AND id IN (${p})`, [username, ...chunk])
              ]);
              items = items.concat(ev, td);
          }
      }
    } else if (body.includes('calendar-query')) {
      let start = 0, end = 2147483647;
      const [ev, td] = await Promise.all([
          getConnection().all(`SELECT *, 'event' as type FROM events WHERE username = ? LIMIT 10000`, [username]),
          getConnection().all(`SELECT *, 'todo' as type FROM todos WHERE username = ? LIMIT 10000`, [username])
      ]);
      items = [...ev, ...td];
    } else {
      let startTs = 0;
      const tokenMatch = body.match(/<D:sync-token>(\d+)<\/D:sync-token>/i);
      if (tokenMatch) startTs = parseInt(tokenMatch[1]);
      const limit = 20000;
      const [ev, td, del] = await Promise.all([
          getConnection().all(`SELECT *, 'event' as type FROM events WHERE username = ? AND updatedAt > ? ORDER BY updatedAt ASC LIMIT ?`, [username, startTs, limit]),
          getConnection().all(`SELECT *, 'todo' as type FROM todos WHERE username = ? AND updatedAt > ? ORDER BY updatedAt ASC LIMIT ?`, [username, startTs, limit]),
          getConnection().all(`SELECT * FROM deleted_items WHERE username = ? AND deletedAt > ? ORDER BY deletedAt ASC LIMIT ?`, [username, startTs, limit])
      ]);
      items = [...ev, ...td].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, limit);
      del.forEach(d => {
          const clientId = toClientCalendarId(username, d.item_id);
          const href = `/caldav/${urlEsc(username)}/${urlEsc(clientId)}.ics`; 
          if (!seenHrefs.has(href)) {
              responses += `<D:response><D:href>${href}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`;
              seenHrefs.add(href);
          }
      });
      const lastItemTs = items.length ? items[items.length-1].updatedAt : 0;
      const lastDelTs = del.length ? del[del.length-1].deletedAt : 0;
      newToken = Math.max(lastItemTs, lastDelTs, startTs);
    }

    if (!newToken) {
        const lastUpdate = await getConnection().get(`SELECT MAX(ts) as maxTs FROM (SELECT updatedAt as ts FROM events WHERE username = ? UNION ALL SELECT updatedAt as ts FROM todos WHERE username = ? UNION ALL SELECT deletedAt as ts FROM deleted_items WHERE username = ?)`, [username, username, username]);
        newToken = lastUpdate && lastUpdate.maxTs ? Math.floor(lastUpdate.maxTs) : Math.floor(Date.now()/1000);
    }

    for (const item of items) {
      const clientId = toClientCalendarId(username, item.id);
      const href = `/caldav/${urlEsc(username)}/${urlEsc(clientId)}.ics`;
      if (seenHrefs.has(href)) continue;
      seenHrefs.add(href);
      const exportItem = { ...item, id: clientId };
      let ical = ICalGenerator.generateCalendar(exportItem.type === 'event' ? [exportItem] : [], exportItem.type === 'todo' ? [exportItem] : [], username, []).replace(/]]>/g, ']] >');
      responses += `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:getetag>"${item.updatedAt}"</D:getetag><D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype><C:calendar-data><![CDATA[${ical}]]></C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
    }
    
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:sync-token>${newToken}</D:sync-token>${responses}</D:multistatus>`);
  } catch (error) { log('ERROR', 'CalDAV REPORT 失败', { error: error.message }); res.status(500).send(); }
});

router.get('/:username/:filename.ics', basicAuthMiddleware, async (req, res) => {
    const { username, filename } = req.params;
    if (username !== req.user) return res.status(403).send();
    let id = filename.replace(/\.ics$/i, '');
    try { id = decodeURIComponent(id); } catch(e) {}
    const scopedId = scopeExternalCalendarId(username, id);
    const item = await getConnection().get('SELECT *, "event" as type FROM events WHERE id IN (?, ?) AND username = ?', [id, scopedId, username]) ||
                 await getConnection().get('SELECT *, "todo" as type FROM todos WHERE id IN (?, ?) AND username = ?', [id, scopedId, username]);
    if (!item) return res.status(404).end();
    const exportItem = { ...item, id: toClientCalendarId(username, item.id) };
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('ETag', `"${item.updatedAt}"`);
    res.send(ICalGenerator.generateCalendar(exportItem.type==='event'?[exportItem]:[],exportItem.type==='todo'?[exportItem]:[],username,[]));
});

router.put('/:username/:filename.ics', basicAuthMiddleware, async (req, res) => {
    try {
        const { username, filename } = req.params;
        if (username !== req.user) return res.status(403).send();
        let id = filename.replace(/\.ics$/i, '');
        try { id = decodeURIComponent(id); } catch(e) {}
        const parsed = ICalParser.parse(req.body || '');
        const now = Math.floor(Date.now() / 1000);
        for (const e of parsed.events) {
            const recurrenceStr = e.recurrence ? JSON.stringify(e.recurrence) : null;
            const eventId = scopeExternalCalendarId(username, e.id || id);
            const ex = await getConnection().get('SELECT id FROM events WHERE id IN (?, ?) AND username = ?', [e.id || id, eventId, username]);
            if (ex) await getConnection().run('UPDATE events SET title=?, description=?, startTime=?, endTime=?, allDay=?, color=?, recurrence=?, recurrenceEnd=?, updatedAt=? WHERE id=? AND username=?', [e.title, e.description||'', e.startTime, e.endTime, e.allDay?1:0, e.color||'#2563eb', recurrenceStr, e.recurrenceEnd||null, now, ex.id, username]);
            else await getConnection().run('INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, recurrence, recurrenceEnd, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [eventId, username, e.title, e.description||'', e.startTime, e.endTime, e.allDay?1:0, e.color||'#2563eb', recurrenceStr, e.recurrenceEnd||null, now, now]);
        }
        for (const t of parsed.todos) {
            const todoId = scopeExternalCalendarId(username, t.id || id);
            const ex = await getConnection().get('SELECT id FROM todos WHERE id IN (?, ?) AND username = ?', [t.id || id, todoId, username]);
            if (ex) await getConnection().run('UPDATE todos SET title=?, description=?, priority=?, dueDate=?, completed=?, updatedAt=? WHERE id=? AND username=?', [t.title, t.description||'', t.priority||5, t.dueDate, t.completed?1:0, now, ex.id, username]);
            else await getConnection().run('INSERT INTO todos (id, username, title, description, priority, dueDate, completed, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)', [todoId, username, t.title, t.description||'', t.priority||5, t.dueDate, t.completed?1:0, now, now]);
        }
        res.setHeader('ETag', `"${now}"`);
        res.status(201).end();
        debouncedBroadcast(username);
    } catch (e) { res.status(500).end(); }
});

router.delete('/:username/:filename.ics', basicAuthMiddleware, async (req, res) => {
    const { username, filename } = req.params;
    if (username !== req.user) return res.status(403).send();
    let id = filename.replace(/\.ics$/i, '');
    try { id = decodeURIComponent(id); } catch(e) {}
    const scopedId = scopeExternalCalendarId(username, id);
    const tombstoneId = toClientCalendarId(username, scopedId);
    await getConnection().run('INSERT INTO deleted_items (id, username, item_id, type, deletedAt) VALUES (?, ?, ?, ?, ?)', [Date.now().toString(36) + Math.random().toString(36).slice(2), username, tombstoneId, 'event', Math.floor(Date.now() / 1000)]);
    await getConnection().run('DELETE FROM events WHERE id IN (?, ?) AND username = ?', [id, scopedId, username]);
    await getConnection().run('DELETE FROM todos WHERE id IN (?, ?) AND username = ?', [id, scopedId, username]);
    res.status(204).end();
    debouncedBroadcast(username);
});

router.mkcalendar('/:username/:calendar', basicAuthMiddleware, (req, res) => {
  if (req.params.username !== req.user) return res.status(403).send();
  return res.status(201).end();
});

module.exports = router;
