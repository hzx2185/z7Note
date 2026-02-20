/**
 * CalDAV 服务器路由
 * 实现 RFC 4791 CalDAV 协议
 */

const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const ICalGenerator = require('../utils/icalGenerator');
const ICalParser = require('../utils/icalParser');
const { basicAuthMiddleware } = require('../middleware/basicAuth');

const router = express.Router();

// 全局中间件，用于日志记录
router.use((req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  console.log(`[CalDAV] ${req.method} ${req.path} - User-Agent: ${userAgent}`);
  // 对于 DELETE 请求,打印更多详细信息
  if (req.method === 'DELETE') {
    console.log(`[CalDAV] DELETE 详情 - 路径: ${req.path}, 原始URL: ${req.originalUrl}, 完整路径: ${req.url}`);
  }
  const originalSend = res.send;
  res.send = function(data) {
    console.log(`[CalDAV] Response: ${res.statusCode} for ${req.method} ${req.path}`);
    return originalSend.call(this, data);
  };
  next();
});

// OPTIONS - 宣告服务器支持的方法
router.options('*', (req, res) => {
  res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, PROPPATCH');
  res.setHeader('DAV', '1, 2, 3, calendar-access, calendar-schedule, sync');
  res.setHeader('MS-Author-Via', 'DAV');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).end();
});

// PROPFIND / - 初始服务发现
router.propfind('/', basicAuthMiddleware, async (req, res) => {
  try {
    const username = req.user;
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/caldav/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal>
          <D:href>/caldav/principals/${username}/</D:href>
        </D:current-user-principal>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', 'CalDAV 根路径 PROPFIND 失败', { error: error.message });
    res.status(500).send();
  }
});

// PROPFIND /principals/:username/ - Principal 发现
router.propfind('/principals/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/caldav/principals/${username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:principal/></D:resourcetype>
        <D:displayname>${username}</D:displayname>
        <C:calendar-home-set>
          <D:href>/caldav/${username}/</D:href>
        </C:calendar-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', 'CalDAV Principals PROPFIND 失败', { error: error.message });
    res.status(500).send();
  }
});

// PROPFIND /:username/ - 日历主目录发现
router.propfind('/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user) return res.status(403).send();

    const depth = req.header('Depth') || '0';
    let ctag = 0;
    let itemsXml = '';

    if (depth === '1') {
      const [events, todos] = await Promise.all([
        getConnection().all('SELECT id, title, updatedAt FROM events WHERE username = ?', [username]),
        getConnection().all('SELECT id, title, updatedAt FROM todos WHERE username = ?', [username])
      ]);
      const items = [...events, ...todos];
        // 计算最新的 updatedAt 作为 ctag
        if (items.length > 0) {
          ctag = Math.max(...items.map(i => i.updatedAt || 0));
        }
      const log = require('../utils/logger');
      log('INFO', 'PROPFIND depth=1', {
        username,
        eventsCount: events.length,
        todosCount: todos.length,
        totalItems: items.length,
        sampleItems: items.slice(0, 3).map(i => ({ id: i.id, title: i.title, updatedAt: i.updatedAt }))
      });
      items.forEach(item => {
        itemsXml += `
  <D:response>
    <D:href>/caldav/${username}/${item.id}.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${item.title}</D:displayname>
        <D:getetag>"${item.updatedAt}"</D:getetag>
        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>
        <D:resourcetype/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
      });
    }

    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/caldav/${username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${username}</D:displayname>
        <C:supported-calendar-component-set>
          <C:comp name="VEVENT"/>
          <C:comp name="VTODO"/>
        </C:supported-calendar-component-set>
        <D:getctag>"${ctag}"</D:getctag>
        <C:calendar-timezone></C:calendar-timezone>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  ${itemsXml}
</D:multistatus>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  } catch (error) {
    log('ERROR', `CalDAV PROPFIND /:username/ 失败`, { error: error.message });
    res.status(500).send();
  }
});

// MKCALENDAR /:username/:calendar - 创建日历
router.mkcalendar('/:username/:calendar', basicAuthMiddleware, (req, res) => {
  if (req.params.username !== req.user) return res.status(403).send();
  log('INFO', 'CalDAV MKCALENDAR 请求 (虚拟成功)', { username: req.params.username });
  res.status(201).send();
});

// PROPPATCH /:username/ - 更新日历属性
router.proppatch('/:username/', basicAuthMiddleware, (req, res) => {
  if (req.params.username !== req.user) return res.status(403).send();
  log('INFO', 'CalDAV PROPPATCH 请求 (虚拟成功)', { username: req.params.username });
  const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/caldav/${req.params.username}/</D:href>
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

// REPORT /:username/ - 获取日历项
router.report('/:username/', basicAuthMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user) return res.status(403).send();

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const log = require('../utils/logger');
        log('INFO', 'REPORT 请求', {
          username,
          bodyPreview: body.substring(0, 500),
          bodyLength: body.length
        });

        // 检查是否是 calendar-multiget 请求
        const isMultiget = body.includes('calendar-multiget');

        if (isMultiget) {
          // 从请求体中提取 href 列表
          const hrefRegex = /<[a-zA-Z0-9_:]*href[^>]*>([^<]+)<\/[a-zA-Z0-9_:]*href>/g;
          const hrefs = [];
          let match;
          while ((match = hrefRegex.exec(body)) !== null) {
            hrefs.push(match[1]);
          }

          const ids = hrefs.map(href => href.match(/\/([^\/]+)\.ics$/)?.[1]).filter(Boolean);

          log('INFO', 'calendar-multiget 请求解析', {
            hrefsCount: hrefs.length,
            idsCount: ids.length,
            sampleHrefs: hrefs.slice(0, 3),
            sampleIds: ids.slice(0, 5)
          });

          let events = [];
          let todos = [];

          if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            [events, todos] = await Promise.all([
              getConnection().all(`SELECT * FROM events WHERE username = ? AND id IN (${placeholders})`, [username, ...ids]),
              getConnection().all(`SELECT * FROM todos WHERE username = ? AND id IN (${placeholders})`, [username, ...ids])
            ]);
          }

          // 过滤掉数据库中不存在的事件，确保只返回实际存在的事件
          const existingEventIds = new Set(events.map(e => e.id));
          const existingTodoIds = new Set(todos.map(t => t.id));
          const existingIds = new Set([...existingEventIds, ...existingTodoIds]);

          log('INFO', 'calendar-multiget 响应', {
            eventsCount: events.length,
            todosCount: todos.length,
            requestedIds: ids.length,
            existingIdsCount: existingIds.size
          });

          // calendar-multiget 应该返回每个请求的href的单独响应
          let responses = '';

          // 为每个请求的item生成单独的响应
          for (const id of ids) {
            const href = `/caldav/${username}/${id}.ics`;
            
            // 检查该ID是否在数据库中存在
            if (existingIds.has(id)) {
              // 找到对应的事件或待办事项
              const item = [...events, ...todos].find(i => i.id === id);
              if (item) {
                const isEvent = !!item.startTime;
                const icalContent = ICalGenerator.generateCalendar(isEvent ? [item] : [], !isEvent ? [item] : [], username);
                log('INFO', 'REPORT 返回ICS内容', {
                  username,
                  itemId: id,
                  itemTitle: item.title,
                  icalContent: icalContent
                });
                responses += `
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"${item.updatedAt}"</D:getetag>
        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>
        <C:calendar-data><![CDATA[${icalContent}]]></C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
              }
            } else {
              // Item不存在，返回404
              // 使用一个特殊的ETag来表示"已删除"状态，帮助客户端清除缓存
              const deletedEtag = `"deleted-${Date.now()}"`;
              responses += `
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${deletedEtag}</D:getetag>
        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>
        <C:calendar-data><![CDATA[END:VCALENDAR]]></C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>`;
            }
          }

          const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
${responses}
</D:multistatus>`;

          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          res.status(207).send(xml);
          return;
        }

        // 非calendar-multiget请求暂不支持,返回空响应
        log('WARN', 'REPORT 不支持的请求类型', { username, bodyPreview: body.substring(0, 200) });
        res.status(207).send(`<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:"/>`);
        return;
      } catch (error) {
        log('ERROR', 'CalDAV REPORT 内部失败', { error: error.message, stack: error.stack });
        res.status(500).send();
      }
    });
  } catch (error) {
    log('ERROR', 'CalDAV REPORT 失败', { error: error.message });
    res.status(500).send();
  }
});

// GET /:username/:filename.ics - 获取单个日历项
router.get('/:username/:filename.ics', basicAuthMiddleware, async (req, res) => {
    try {
        const { username, filename } = req.params;
        if (username !== req.user) return res.status(403).send();
        const item = await getConnection().get('SELECT * FROM events WHERE id = ? AND username = ?', [filename, username]) || 
                     await getConnection().get('SELECT * FROM todos WHERE id = ? AND username = ?', [filename, username]);
        if (item) {
            const isEvent = !!item.startTime;
            const icalContent = ICalGenerator.generateCalendar(isEvent ? [item] : [], !isEvent ? [item] : [], username);
            log('INFO', 'CalDAV GET 返回ICS内容', {
                username,
                filename,
                itemTitle: item.title,
                icalContent: icalContent
            });
            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader('ETag', `"${item.updatedAt}"`);
            res.send(icalContent);
        } else {
            res.status(404).send('Not Found');
        }
    } catch (error) {
        log('ERROR', 'CalDAV GET .ics 失败', { error: error.message });
        res.status(500).send();
    }
});

// PUT /:username/:filename.ics - 创建或更新日历项
router.put('/:username/:filename.ics', basicAuthMiddleware, async (req, res) => {
    // This logic seems fine, keeping as is
    try {
        const { username, filename } = req.params;
        if (username !== req.user) return res.status(403).send();

        let icalData = '';
        req.on('data', chunk => icalData += chunk);
        req.on('end', async () => {
          let parsed;
          try {
            log('INFO', 'CalDAV PUT 收到原始ICS数据', {
              username,
              filename,
              icalData
            });
            parsed = ICalParser.parse(icalData);
            log('INFO', 'CalDAV PUT 解析结果', {
                username,
                filename,
                events: parsed?.events?.length || 0,
                todos: parsed?.todos?.length || 0
            });
            log('INFO', 'CalDAV PUT 解析结果', {
                events: parsed?.events?.length || 0,
                todos: parsed?.todos?.length || 0,
                eventIds: parsed?.events?.map(e => e.id) || [],
                todoIds: parsed?.todos?.map(t => t.id) || []
            });
            if (parsed && parsed.events && parsed.events.length > 0) {
              log('INFO', 'CalDAV PUT 准备保存事件', {
                eventCount: parsed.events.length,
                events: parsed.events.map(ev => ({
                  id: ev.id,
                  title: ev.title,
                  startTime: ev.startTime,
                  endTime: ev.endTime,
                  allDay: ev.allDay,
                  startTimeDate: ev.startTime ? new Date(ev.startTime * 1000).toISOString() : null,
                  endTimeDate: ev.endTime ? new Date(ev.endTime * 1000).toISOString() : null,
                  recurrence: ev.recurrence,
                  recurrenceEnd: ev.recurrenceEnd
                }))
              });
              for (const event of parsed.events) {
                try {
                  const existing = await getConnection().get('SELECT id FROM events WHERE id = ? AND username = ?', [event.id, username]);
                  log('INFO', 'CalDAV PUT 检查事件是否存在', { eventId: event.id, exists: !!existing });
                  if (existing) {
                    log('INFO', 'CalDAV PUT 更新事件', { eventId: event.id, title: event.title, recurrence: event.recurrence });
                    await getConnection().run('UPDATE events SET title=?, description=?, startTime=?, endTime=?, allDay=?, color=?, noteId=?, recurrence=?, recurrenceEnd=?, timezone=?, updatedAt=? WHERE id=? AND username=?', [event.title, event.description || '', event.startTime, event.endTime, event.allDay ? 1:0, event.color || '#2563eb', event.noteId || null, event.recurrence ? JSON.stringify(event.recurrence) : null, event.recurrenceEnd || null, event.timezone || null, Math.floor(Date.now()/1000), event.id, username]);
                  } else {
                    log('INFO', 'CalDAV PUT 插入事件', { eventId: event.id, title: event.title, recurrence: event.recurrence });
                    await getConnection().run('INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, noteId, recurrence, recurrenceEnd, timezone, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [event.id, username, event.title, event.description || '', event.startTime, event.endTime, event.allDay ? 1:0, event.color || '#2563eb', event.noteId || null, event.recurrence ? JSON.stringify(event.recurrence) : null, event.recurrenceEnd || null, event.timezone || null, Math.floor(Date.now()/1000), Math.floor(Date.now()/1000)]);
                  }
                  log('INFO', 'CalDAV PUT 事件保存成功', { eventId: event.id, title: event.title });
                } catch (dbError) {
                  log('ERROR', 'CalDAV PUT 数据库操作失败', { eventId: event.id, error: dbError.message, stack: dbError.stack });
                }
              }
            }
            if (parsed && parsed.todos && parsed.todos.length > 0) {
              for (const todo of parsed.todos) {
                  const existing = await getConnection().get('SELECT id FROM todos WHERE id = ? AND username = ?', [todo.id, username]);
                  if (existing) {
                      await getConnection().run('UPDATE todos SET title=?, description=?, priority=?, dueDate=?, completed=?, noteId=?, updatedAt=? WHERE id=? AND username=?', [todo.title, todo.description || '', todo.priority || 5, todo.dueDate, todo.completed ? 1:0, todo.noteId || null, Math.floor(Date.now()/1000), todo.id, username]);
                  } else {
                      await getConnection().run('INSERT INTO todos (id, username, title, description, priority, dueDate, completed, noteId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)', [todo.id, username, todo.title, todo.description || '', todo.priority || 5, todo.dueDate, todo.completed ? 1:0, todo.noteId || null, Math.floor(Date.now()/1000), Math.floor(Date.now()/1000)]);
                  }
              }
            }
            res.setHeader('ETag', `"${Date.now()}"`);
            res.status(201).send();
          } catch (e) {
            log('ERROR', 'CalDAV PUT 保存失败', {
              error: e.message,
              stack: e.stack,
              parsedEvents: parsed?.events?.map(ev => ({
                id: ev.id,
                title: ev.title,
                startTime: ev.startTime,
                endTime: ev.endTime,
                allDay: ev.allDay
              })) || []
            });
            res.status(400).send();
          }
        });
    } catch (error) {
        log('ERROR', 'CalDAV PUT .ics 失败', { error: error.message });
        res.status(500).send();
    }
});

// DELETE /:username/:filename.ics - 删除日历项
router.delete('/:username/:filename.ics', basicAuthMiddleware, async (req, res) => {
    try {
        const { username, filename } = req.params;
        log('INFO', 'CalDAV DELETE 事件', {
            username,
            filename,
            fullPath: req.path
        });

        if (username !== req.user) return res.status(403).send();
        const eventResult = await getConnection().run('DELETE FROM events WHERE id = ? AND username = ?', [filename, username]);
        log('INFO', 'CalDAV DELETE 结果', {
            eventsDeleted: eventResult.changes,
            filename
        });
        if (eventResult.changes === 0) {
            const todoResult = await getConnection().run('DELETE FROM todos WHERE id = ? AND username = ?', [filename, username]);
            log('INFO', 'CalDAV DELETE TODO 结果', {
                todosDeleted: todoResult.changes,
                filename
            });
        }
        res.status(204).send();
    } catch (error) {
        log('ERROR', 'CalDAV DELETE .ics 失败', { error: error.message });
        res.status(500).send();
    }
});

// DELETE /:username/ - 阻止删除整个日历目录
router.delete('/:username/', basicAuthMiddleware, async (req, res) => {
    const { username } = req.params;
    log('WARN', 'CalDAV 尝试删除日历目录(已阻止)', {
        username,
        fullPath: req.path,
        userAgent: req.headers['user-agent'],
        reason: '不允许删除整个日历目录，只允许删除单个事件'
    });

    // 返回403 Forbidden，阻止删除整个日历
    res.status(403).send('Cannot delete entire calendar. Use DELETE /:username/:id.ics to delete individual items.');
});

// Helper function to generate response for REPORT
async function generateMultiStatusResponseWithData(username, events, todos) {
  let responses = '';
  const items = [...events, ...todos];
        // 计算最新的 updatedAt 作为 ctag
        if (items.length > 0) {
          ctag = Math.max(...items.map(i => i.updatedAt || 0));
        }

  for (const item of items) {
    const isEvent = !!item.startTime;
    const href = `/caldav/${username}/${item.id}.ics`;
    const icalContent = ICalGenerator.generateCalendar(isEvent ? [item] : [], !isEvent ? [item] : [], username);
    responses += `
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"${item.updatedAt}"</D:getetag>
        <C:calendar-data><![CDATA[${icalContent}]]></C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
  }

  return `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
${responses}
</D:multistatus>`;
}

module.exports = router;