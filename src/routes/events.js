const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const TimeHelper = require('../utils/timeHelper');
const { broadcast } = require('./ws');
const lunarHelper = require('../utils/lunarHelper');

const router = express.Router();

// 获取事件列表
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = 'SELECT * FROM events WHERE username = ?';
    let params = [req.user];
    
    if (startDate && endDate) {
      // 确保查询逻辑能覆盖所有在该范围内的事件（含重复事件）
      query += ` AND (
        (recurrence IS NOT NULL AND recurrence != '')
        OR
        (startTime <= ? AND (endTime > ? OR endTime IS NULL))
      )`;
      params.push(parseInt(endDate), parseInt(startDate));
    }
    const events = await getConnection().all(query, params);
    res.json(events);
  } catch (e) { res.status(500).json({ error: '获取失败' }); }
});

// 批量删除
router.delete('/batch', async (req, res) => {
  try {
    const { ids, startTime, endTime, all } = req.body;
    const db = getConnection();
    const now = Math.floor(Date.now() / 1000);
    
    if (all === true) {
      // 记录所有即将被删除的 ID
      const items = await db.all('SELECT id FROM events WHERE username = ?', [req.user]);
      for (const item of items) {
          await db.run('INSERT INTO deleted_items (id, username, item_id, type, deletedAt) VALUES (?, ?, ?, ?, ?)', 
              [Date.now().toString(36) + Math.random().toString(36).slice(2), req.user, item.id, 'event', now]);
      }
      await db.run('DELETE FROM events WHERE username = ?', [req.user]);
    } else if (startTime && endTime) {
      const items = await db.all('SELECT id FROM events WHERE username = ? AND startTime >= ? AND startTime <= ?', [req.user, startTime, endTime]);
      for (const item of items) {
          await db.run('INSERT INTO deleted_items (id, username, item_id, type, deletedAt) VALUES (?, ?, ?, ?, ?)', 
              [Date.now().toString(36) + Math.random().toString(36).slice(2), req.user, item.id, 'event', now]);
      }
      await db.run('DELETE FROM events WHERE username = ? AND startTime >= ? AND startTime <= ?', [req.user, startTime, endTime]);
    } else if (Array.isArray(ids) && ids.length > 0) {
      for (const id of ids) {
          await db.run('INSERT INTO deleted_items (id, username, item_id, type, deletedAt) VALUES (?, ?, ?, ?, ?)', 
              [Date.now().toString(36) + Math.random().toString(36).slice(2), req.user, id, 'event', now]);
      }
      const placeholders = ids.map(() => '?').join(',');
      await db.run(`DELETE FROM events WHERE username = ? AND id IN (${placeholders})`, [req.user, ...ids]);
    } else {
      return res.status(400).json({ error: '无效的删除请求' });
    }
    
    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '批量删除失败: ' + e.message });
  }
});

// 批量展开农历重复事件 (供月视图标记使用)
router.get('/expand-lunar', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '缺少范围参数' });

    const start = parseInt(startDate);
    const end = parseInt(endDate);
    const db = getConnection();
    
    // 只查询带有农历重复规则的事件
    const lunarMasters = await db.all(
      "SELECT * FROM events WHERE username = ? AND recurrence LIKE '%lunar_%'",
      [req.user]
    );

    const allExpanded = [];
    for (const master of lunarMasters) {
      const instances = lunarHelper.generateLunarRecurringEvents(master, start, end);
      allExpanded.push(...instances);
    }

    res.json(allExpanded);
  } catch (e) {
    log('ERROR', '批量展开农历事件失败', { error: e.message });
    res.status(500).json({ error: '展开失败' });
  }
});

// 数据规范化/修复
router.post('/format', async (req, res) => {
  try {
    const db = getConnection();
    const events = await db.all('SELECT * FROM events WHERE username = ?', [req.user]);
    let fixedCount = 0;
    
    for (const event of events) {
      let needsUpdate = false;
      let newStart = event.startTime;
      let newEnd = event.endTime;
      
      if (event.allDay === 1) {
          // 核心修复：全天事件标准化 (RFC 5545)
          
          // 1. 将开始时间对齐到最近的 UTC 00:00:00 (86400的倍数)
          const utcStart = Math.round(event.startTime / 86400) * 86400;
          if (utcStart !== event.startTime) {
              newStart = utcStart;
              needsUpdate = true;
          }
          
          // 2. 确保结束时间是排他的 (下一天 00:00:00)
          // 计算跨度，至少为 1 天
          let days = Math.max(1, Math.round((event.endTime - event.startTime) / 86400));
          const utcEnd = utcStart + (days * 86400);
          if (utcEnd !== event.endTime) {
              newEnd = utcEnd;
              needsUpdate = true;
          }
      } else {
          // 非全天事件：修复可能存在的时间戳位数问题
          newStart = TimeHelper.parseToTs(event.startTime);
          newEnd = TimeHelper.parseToTs(event.endTime);
          if (newStart !== event.startTime || newEnd !== event.endTime) {
              needsUpdate = true;
          }
      }
      
      // 3. 规范化 ID (移除非法 XML 字符)
      const cleanId = event.id.replace(/[<>&'"]/g, '');
      let finalId = event.id;
      if (cleanId !== event.id) {
          finalId = cleanId;
          needsUpdate = true;
      }

      if (needsUpdate) {
        await db.run(
            `UPDATE events SET id = ?, startTime = ?, endTime = ?, updatedAt = ? WHERE id = ? AND username = ?`, 
            [finalId, newStart, newEnd, Math.floor(Date.now() / 1000), event.id, req.user]
        );
        fixedCount++;
      }
    }
    
    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });
    res.json({ success: true, fixedCount });
  } catch (e) {
    res.status(500).json({ error: '格式化失败: ' + e.message });
  }
});

// 导出全量日历 (ICS 格式)
router.get('/export', async (req, res) => {
  try {
    const db = getConnection();
    const username = req.user;
    const ICalGenerator = require('../utils/icalGenerator');

    const [events, todos] = await Promise.all([
      db.all('SELECT * FROM events WHERE username = ?', [username]),
      db.all('SELECT * FROM todos WHERE username = ?', [username])
    ]);

    const icsContent = ICalGenerator.generateCalendar(events, todos, username, []);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="z7note-calendar-${Date.now()}.ics"`);
    res.send(icsContent);
  } catch (e) {
    log('ERROR', '导出日历失败', { error: e.message });
    res.status(500).json({ error: '导出失败: ' + e.message });
  }
});

// 导入全量日历 (ICS 格式)
router.post('/import', async (req, res) => {
  try {
    const { icsContent } = req.body;
    if (!icsContent) return res.status(400).json({ error: '缺少 icsContent' });

    const ICalParser = require('../utils/icalParser');
    const parsed = ICalParser.parse(icsContent);
    const username = req.user;
    const db = getConnection();
    const now = Math.floor(Date.now() / 1000);

    let imported = 0;
    let skipped = 0;
    let updated = 0;

    // 导入事件
    for (const e of parsed.events) {
      const recurrenceStr = e.recurrence ? JSON.stringify(e.recurrence) : null;

      // 1. 检查是否存在相同的事件（通过ID）
      let existing;
      if (e.id) {
        existing = await db.get('SELECT id, subscriptionId FROM events WHERE id = ? AND username = ?', [e.id, username]);
      }

      // 2. 如果没有ID或ID不存在，检查是否有相同标题和开始时间的事件
      // 关键：同时检查常规事件和订阅事件
      if (!existing && e.title && e.startTime) {
        existing = await db.get(
          'SELECT id, subscriptionId FROM events WHERE username = ? AND title = ? AND startTime = ?',
          [username, e.title, e.startTime]
        );
      }

      if (existing) {
        // 如果该事件属于订阅日历，直接跳过，不要导入为本地事件
        if (existing.subscriptionId) {
          skipped++;
          continue;
        }

        // 更新现有本地事件
        await db.run(
          'UPDATE events SET title=?, description=?, startTime=?, endTime=?, allDay=?, color=?, recurrence=?, recurrenceEnd=?, updatedAt=? WHERE id=? AND username=?',
          [e.title, e.description || '', e.startTime, e.endTime, e.allDay ? 1 : 0, e.color || '#2563eb', recurrenceStr, e.recurrenceEnd || null, now, existing.id, username]
        );
        updated++;
      } else {
        // 插入新事件
        const eventId = e.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await db.run(
          'INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, recurrence, recurrenceEnd, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [eventId, username, e.title, e.description || '', e.startTime, e.endTime, e.allDay ? 1 : 0, e.color || '#2563eb', recurrenceStr, e.recurrenceEnd || null, now, now]
        );
        imported++;
      }
    }

    // 导入待办
    for (const t of parsed.todos) {
      // 检查是否存在相同的待办（通过ID或标题+截止日期）
      let existing;
      if (t.id) {
        existing = await db.get('SELECT id FROM todos WHERE id = ? AND username = ?', [t.id, username]);
      }

      // 如果没有ID或ID不存在，检查是否有相同标题和截止日期的待办
      if (!existing && t.title && t.dueDate) {
        existing = await db.get(
          'SELECT id FROM todos WHERE username = ? AND title = ? AND dueDate = ?',
          [username, t.title, t.dueDate]
        );
      }

      if (existing) {
        // 更新现有待办
        await db.run(
          'UPDATE todos SET title=?, description=?, priority=?, dueDate=?, completed=?, updatedAt=? WHERE id=? AND username=?',
          [t.title, t.description || '', t.priority || 5, t.dueDate, t.completed ? 1 : 0, now, existing.id, username]
        );
        updated++;
        skipped++;
      } else {
        // 插入新待办
        const todoId = t.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await db.run(
          'INSERT INTO todos (id, username, title, description, priority, dueDate, completed, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
          [todoId, username, t.title, t.description || '', t.priority || 5, t.dueDate, t.completed ? 1 : 0, now, now]
        );
        imported++;
      }
    }

    broadcast('calendar_update', { username, type: 'sync' }, { targetUsername: username });
    res.json({ success: true, imported, skipped, updated });
  } catch (e) {
    log('ERROR', '导入日历失败', { error: e.message });
    res.status(500).json({ error: '导入失败: ' + e.message });
  }
});

// 清理重复事件 (基于标题、开始时间、结束时间、重复规则等全项匹配)
router.post('/cleanup-duplicates', async (req, res) => {
  try {
    const db = getConnection();
    const username = req.user;
    
    // 查找重复组：标题、开始时间、结束时间、重复规则、全天标志完全相同
    const duplicates = await db.all(`
      SELECT title, startTime, endTime, recurrence, allDay, COUNT(*) as count 
      FROM events 
      WHERE username = ? 
      GROUP BY title, startTime, endTime, COALESCE(recurrence, ''), allDay 
      HAVING count > 1
    `, [username]);
    
    let deletedCount = 0;
    const now = Math.floor(Date.now() / 1000);
    
    for (const dup of duplicates) {
      // 对每一组重复项，保留 ID 最新（更新时间最近）的一条，删除其他的
      const items = await db.all(
        `SELECT id FROM events 
         WHERE username = ? AND title = ? AND startTime = ? 
         AND (endTime = ? OR (endTime IS NULL AND ? IS NULL))
         AND (recurrence = ? OR (recurrence IS NULL AND ? IS NULL))
         AND allDay = ?
         ORDER BY updatedAt DESC`,
        [username, dup.title, dup.startTime, dup.endTime, dup.endTime, dup.recurrence, dup.recurrence, dup.allDay]
      );
      
      const idsToDelete = items.slice(1).map(item => item.id);
      if (idsToDelete.length > 0) {
        for (const id of idsToDelete) {
          await db.run('INSERT INTO deleted_items (id, username, item_id, type, deletedAt) VALUES (?, ?, ?, ?, ?)', 
              [Date.now().toString(36) + Math.random().toString(36).slice(2), username, id, 'event', now]);
        }
        const placeholders = idsToDelete.map(() => '?').join(',');
        await db.run(`DELETE FROM events WHERE username = ? AND id IN (${placeholders})`, [username, ...idsToDelete]);
        deletedCount += idsToDelete.length;
      }
    }
    
    broadcast('calendar_update', { username, type: 'sync' }, { targetUsername: username });
    res.json({ success: true, deletedCount });
  } catch (e) {
    log('ERROR', '清理重复事件失败', { error: e.message });
    res.status(500).json({ error: '清理失败: ' + e.message });
  }
});

// 获取详情
router.get('/:id', async (req, res) => {
  try {
    const event = await getConnection().get('SELECT * FROM events WHERE id = ? AND username = ?', [req.params.id, req.user]);
    if (!event) return res.status(404).json({ error: '事件不存在' });
    res.json(event);
  } catch (e) { res.status(500).json({ error: '获取详情失败' }); }
});

// 创建事件
router.post('/', async (req, res) => {
  try {
    const { title, description, startTime, endTime, allDay, reminderEmail, reminderBrowser, reminderCaldav, recurrence, recurrenceEnd } = req.body;
    if (!title) return res.status(400).json({ error: '标题不能为空' });

    const startTs = TimeHelper.parseToTs(startTime);
    if (!startTs) return res.status(400).json({ error: '开始时间无效' });

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await getConnection().run(
      `INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, reminderEmail, reminderBrowser, reminderCaldav, recurrence, recurrenceEnd, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.user, title.trim(), description || '',
        startTs, TimeHelper.parseToTs(endTime), allDay ? 1 : 0, '#2563eb',
        reminderEmail ? 1 : 0, reminderBrowser ? 1 : 0, reminderCaldav ? 1 : 0,
        recurrence || null, TimeHelper.parseToTs(recurrenceEnd),
        Math.floor(Date.now()/1000), Math.floor(Date.now()/1000)
      ]
    );
    
    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });
    
    res.json({ id, title });
  } catch (e) { res.status(500).json({ error: '创建失败' }); }
});

// 更新事件
router.put('/:id', async (req, res) => {
  try {
    const { title, description, startTime, endTime, allDay, reminderEmail, reminderBrowser, reminderCaldav, recurrence, recurrenceEnd } = req.body;
    const existing = await getConnection().get('SELECT * FROM events WHERE id = ? AND username = ?', [req.params.id, req.user]);
    if (!existing) return res.status(404).json({ error: '事件不存在' });

    const updates = [];
    const params = [];

    const fields = {
      title: (v) => v?.trim(),
      description: (v) => v,
      startTime: TimeHelper.parseToTs,
      endTime: TimeHelper.parseToTs,
      allDay: (v) => v ? 1 : 0,
      reminderEmail: (v) => v ? 1 : 0,
      reminderBrowser: (v) => v ? 1 : 0,
      reminderCaldav: (v) => v ? 1 : 0,
      recurrence: (v) => v || null,
      recurrenceEnd: TimeHelper.parseToTs
    };

    for (const [key, parser] of Object.entries(fields)) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(parser(req.body[key]));
      }
    }

    if (updates.length === 0) return res.json({ success: true });

    updates.push('updatedAt = ?');
    params.push(Math.floor(Date.now() / 1000));

    params.push(req.params.id, req.user);
    await getConnection().run(`UPDATE events SET ${updates.join(', ')} WHERE id = ? AND username = ?`, params);

    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });

    res.json({ success: true });
  } catch (e) { 
    res.status(500).json({ error: '更新失败: ' + e.message }); 
  }
});

// 删除
router.delete('/:id', async (req, res) => {
  const db = getConnection();
  const now = Math.floor(Date.now() / 1000);
  
  // 记录删除记录供 CalDAV 同步
  await db.run('INSERT INTO deleted_items (id, username, item_id, type, deletedAt) VALUES (?, ?, ?, ?, ?)', 
      [Date.now().toString(36) + Math.random().toString(36).slice(2), req.user, req.params.id, 'event', now]);
      
  await db.run('DELETE FROM events WHERE id = ? AND username = ?', [req.params.id, req.user]);
  
  broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });
  
  res.json({ success: true });
});

// 天数据
router.get('/calendar/day/:date', async (req, res) => {
  try {
    // 解析日期字符串 (YYYY-MM-DD)
    const [year, month, day] = req.params.date.split("-").map(Number);
    // 使用本地时区创建日期对象
    const d = new Date(year, month - 1, day);
    const start = Math.floor(d.setHours(0,0,0,0)/1000), end = Math.floor(d.setHours(23,59,59,999)/1000);
    
    // 判断是否为"今天"
    const now = new Date();
    const isToday = now.getFullYear() === year && now.getMonth() === (month - 1) && now.getDate() === day;
    
    // 查询待办：如果请求的是今天，则包含没有截止日期的待办
    let todoQuery = 'SELECT * FROM todos WHERE username=? AND dueDate>=? AND dueDate<=?';
    let todoParams = [req.user, start, end];
    
    if (isToday) {
      todoQuery = 'SELECT * FROM todos WHERE username=? AND (dueDate IS NULL OR (dueDate>=? AND dueDate<=?))';
    }

    const [todos, rawEvents, notes] = await Promise.all([
      getConnection().all(todoQuery, todoParams),
      getConnection().all('SELECT * FROM events WHERE username=? AND (recurrence IS NOT NULL OR (startTime<=? AND (endTime>=? OR endTime IS NULL)))', [req.user, end, start]),
      getConnection().all('SELECT * FROM notes WHERE username=? AND deleted=0 AND updatedAt >= ?', [req.user, start*1000])
    ]);
    
    // 过滤出当天的笔记
    const dayNotes = notes.filter(n => {
      const ts = n.updatedAt / 1000;
      return ts >= start && ts <= end;
    });

    // 展开重复事件
    const expandedEvents = [];
    const dayStart = new Date(start * 1000);
    const dayEnd = new Date(end * 1000);
    
    rawEvents.forEach(e => {
      if (!e.recurrence) {
        // 非重复事件，直接添加
        if (e.allDay) {
            // 全天事件判定逻辑：
            // 数据库中 e.startTime 和 e.endTime 是 UTC 00:00
            // 如果 e.startTime >= 当天 23:59:59 (local) -> 肯定不在今天
            // 如果 e.endTime <= 当天 00:00:00 (local) -> 肯定不在今天
            // 特殊处理：如果 e.endTime 刚好是下一天的 UTC 00:00，在本地显示时不应跨天
            
            // 将 UTC 时间转为本地感知日期进行比较
            const dStart = new Date(e.startTime * 1000);
            const startStr = `${dStart.getUTCFullYear()}-${String(dStart.getUTCMonth()+1).padStart(2,'0')}-${String(dStart.getUTCDate()).padStart(2,'0')}`;
            
            const dEnd = new Date((e.endTime || e.startTime) * 1000 - 1000);
            const endStr = `${dEnd.getUTCFullYear()}-${String(dEnd.getUTCMonth()+1).padStart(2,'0')}-${String(dEnd.getUTCDate()).padStart(2,'0')}`;
            
            const targetStr = req.params.date; // YYYY-MM-DD
            
            if (targetStr < startStr || targetStr > endStr) {
                return;
            }
        }
        expandedEvents.push(e);
      } else {
        // 重复事件，展开
        try {
          const r = typeof e.recurrence === 'string' ? JSON.parse(e.recurrence) : e.recurrence;
          
          // 处理农历重复
          if (r.type && r.type.startsWith('lunar_')) {
            const lunarEvents = lunarHelper.generateLunarRecurringEvents(e, start, end);
            expandedEvents.push(...lunarEvents);
            return;
          }

          let cur = new Date(e.startTime * 1000);
          const maxEnd = e.recurrenceEnd ? new Date(e.recurrenceEnd * 1000) : dayEnd;
          
          let count = 0;
          while (cur <= maxEnd && cur <= dayEnd && count < 100) {
            // 检查是否在当天
            if (cur >= dayStart && cur <= dayEnd) {
              expandedEvents.push({
                ...e,
                _originalId: e.id,
                isRecurringInstance: true,
                startTime: Math.floor(cur.getTime() / 1000),
                endTime: e.endTime ? Math.floor(cur.getTime() / 1000 + (e.endTime - e.startTime)) : null
              });
            }
            
            // 根据重复类型推进时间
            if (r.type === 'daily') cur.setDate(cur.getDate() + (r.interval || 1));
            else if (r.type === 'weekly') cur.setDate(cur.getDate() + 7 * (r.interval || 1));
            else if (r.type === 'monthly') cur.setMonth(cur.getMonth() + (r.interval || 1));
            else if (r.type === 'yearly') cur.setFullYear(cur.getFullYear() + (r.interval || 1));
            else break;
            count++;
          }
        } catch (err) {
          // 解析失败，添加原始事件
          expandedEvents.push(e);
        }
      }
    });

    res.json({ todos, events: expandedEvents, notes: dayNotes });
  } catch (e) { res.status(500).json({ error: '查询失败' }); }
});

// 搜索事件和待办

module.exports = router;
