const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const { exportToICS, importFromICS, detectICSSource } = require('../utils/icsExport');

const router = express.Router();

// 导出日历为ICS格式 (增强版)
router.get('/export', async (req, res) => {
  try {
    const { targetApp, includeReminders } = req.query;

    const events = await getConnection().all(
      'SELECT * FROM events WHERE username = ? ORDER BY startTime ASC',
      [req.user]
    );

    const icsContent = exportToICS(events, {
      targetApp: targetApp || 'standard',
      includeReminders: includeReminders !== 'false'
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=z7note-calendar-${new Date().toISOString().split('T')[0]}.ics`);
    res.send(icsContent);

    log('INFO', '导出日历', { username: req.user, eventCount: events.length, targetApp });
  } catch (e) {
    log('ERROR', '导出日历失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '导出失败' });
  }
});

// 从ICS格式导入日历 (增强版)
router.post('/import', async (req, res) => {
  try {
    const { icsContent, sourceApp } = req.body;

    if (!icsContent) {
      return res.status(400).json({ error: 'ICS内容不能为空' });
    }

    const detectedSource = sourceApp || detectICSSource(icsContent);
    const importedEvents = importFromICS(icsContent, {
      sourceApp: detectedSource,
      importReminders: true
    });

    if (importedEvents.length === 0) {
      return res.status(400).json({ error: '未找到有效的事件' });
    }

    let importedCount = 0;
    const skippedCount = [];

    for (const event of importedEvents) {
      try {
        // 检查事件是否已存在
        const existing = await getConnection().get(
          'SELECT id FROM events WHERE id = ? AND username = ?',
          [event.id, req.user]
        );

        if (existing) {
          skippedCount.push(event.title);
          continue;
        }

        // 创建事件
        const id = event.id || Date.now().toString(36) + Math.random().toString(36).slice(2);
        await getConnection().run(
          `INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, noteId, recurrence, reminderEmail, reminderBrowser, reminderCaldav, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            req.user,
            event.title || '未命名事件',
            event.description || '',
            event.startTime || Math.floor(Date.now() / 1000),
            event.endTime || null,
            event.allDay ? 1 : 0,
            event.color || '#2563eb',
            null,
            event.recurrence ? JSON.stringify(event.recurrence) : null,
            event.reminderEmail ? 1 : 0,
            event.reminderBrowser ? 1 : 0,
            event.reminderCaldav ? 1 : 0,
            Math.floor(Date.now() / 1000),
            Math.floor(Date.now() / 1000)
          ]
        );

        importedCount++;
      } catch (err) {
        log('ERROR', '导入单个事件失败', { username: req.user, event, error: err.message });
      }
    }

    log('INFO', '导入日历', {
      username: req.user,
      imported: importedCount,
      skipped: skippedCount.length,
      source: detectedSource
    });

    res.json({
      success: true,
      imported: importedCount,
      skipped: skippedCount.length,
      skippedEvents: skippedCount,
      source: detectedSource
    });
  } catch (e) {
    log('ERROR', '导入日历失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '导入失败' });
  }
});

// 获取事件列表
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (startDate && endDate) {
      // 查询在指定时间范围内的事件，以及所有的重复事件
      // 这样永久重复的事件可以在任何月份看到
      const query = `
        SELECT * FROM events 
        WHERE username = ? 
        AND (
          -- 当前月份的事件
          ((startTime >= ? AND startTime <= ?) OR (endTime >= ? AND endTime <= ?) OR (startTime <= ? AND endTime >= ?))
          OR
          -- 重复事件（无论开始时间）
          (recurrence IS NOT NULL AND recurrence != '')
        )
        ORDER BY startTime ASC
      `;
      const params = [
        req.user,
        parseInt(startDate),
        parseInt(endDate),
        parseInt(startDate),
        parseInt(endDate),
        parseInt(startDate),
        parseInt(endDate)
      ];

      const events = await getConnection().all(query, params);
      res.json(events);
    } else {
      // 如果没有指定时间范围，返回所有事件
      const query = 'SELECT * FROM events WHERE username = ? ORDER BY startTime ASC';
      const events = await getConnection().all(query, [req.user]);
      res.json(events);
    }
  } catch (e) {
    log('ERROR', '获取事件失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 展开农历重复事件
  // 注意：此路由必须在 /:id 之前定义，否则会被 :id 参数路由拦截
  router.get('/expand-lunar', async (req, res) => {
    try {
      console.log('[API expand-lunar] request received');
      console.log('[API expand-lunar] user:', req.user);
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: '缺少startDate或endDate参数' });
      }

      const start = parseInt(startDate);
      const end = parseInt(endDate);
      console.log('[API expand-lunar] start:', start, 'end:', end);

      // 获取所有重复事件
      const events = await getConnection().all(
        'SELECT * FROM events WHERE username = ? AND recurrence IS NOT NULL AND recurrence != ""',
        [req.user]
      );
      console.log('[API expand-lunar] found events:', events.length);
      console.log('[API expand-lunar] events:', JSON.stringify(events, null, 2));

      const expandedEvents = [];
      const { generateLunarRecurringEvents } = require('../utils/lunarHelper');

      for (const event of events) {
        console.log('[API expand-lunar] processing event:', event.id, event.title);
        let recurrence = event.recurrence;
        if (typeof recurrence === 'string') {
          try {
            recurrence = JSON.parse(recurrence);
          } catch (e) {
            console.log('[API expand-lunar] parse recurrence failed:', e);
            continue;
          }
        }

        console.log('[API expand-lunar] recurrence:', recurrence);
        // 只处理农历重复事件
        if (recurrence && recurrence.type && recurrence.type.startsWith('lunar_')) {
          const instances = generateLunarRecurringEvents(event, start, end);
          console.log('[API expand-lunar] instances generated:', instances.length);
          console.log('[API expand-lunar] instances:', JSON.stringify(instances, null, 2));
          expandedEvents.push(...instances);
        }
      }

      console.log('[API expand-lunar] returning:', expandedEvents.length, 'events');
      res.json(expandedEvents);
    } catch (e) {
      log('ERROR', '展开农历重复事件失败', {
        username: req.user,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        error: e.message
      });
      res.status(500).json({ error: '展开失败', message: e.message });
    }
  });

// 获取单个事件
router.get('/:id', async (req, res) => {
  try {
    const event = await getConnection().get(
      'SELECT * FROM events WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );
    if (!event) return res.status(404).json({ error: '事件不存在' });
    res.json(event);
  } catch (e) {
    log('ERROR', '获取事件失败', { username: req.user, eventId: req.params.id, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 创建事件
router.post('/', async (req, res) => {
  try {
    const { title, description, startTime, endTime, allDay, color, noteId, reminderEmail, reminderBrowser, reminderCaldav, recurrence, recurrenceEnd } = req.body;

    // 数据验证
    if (!title || !title.trim()) {
      return res.status(400).json({ error: '标题不能为空' });
    }

    if (title.trim().length > 200) {
      return res.status(400).json({ error: '标题长度不能超过200个字符' });
    }

    if (description && description.length > 1000) {
      return res.status(400).json({ error: '描述长度不能超过1000个字符' });
    }

    if (!startTime || isNaN(parseInt(startTime))) {
      return res.status(400).json({ error: '开始时间不能为空' });
    }

    if (endTime && isNaN(parseInt(endTime))) {
      return res.status(400).json({ error: '无效的结束时间' });
    }

    if (endTime && parseInt(endTime) <= parseInt(startTime)) {
      return res.status(400).json({ error: '结束时间必须晚于开始时间' });
    }

    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return res.status(400).json({ error: '无效的颜色格式' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await getConnection().run(
      `INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, noteId, reminderEmail, reminderBrowser, reminderCaldav, recurrence, recurrenceEnd, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user,
        title.trim(),
        description ? description.trim() : '',
        parseInt(startTime),
        endTime ? parseInt(endTime) : null,
        allDay ? 1 : 0,
        color || '#2563eb',
        noteId || null,
        reminderEmail ? 1 : 0,
        reminderBrowser ? 1 : 0,
        reminderCaldav ? 1 : 0,
        recurrence || null,
        recurrenceEnd ? parseInt(recurrenceEnd) : null,
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000)
      ]
    );

    const event = await getConnection().get('SELECT * FROM events WHERE id = ?', [id]);
    log('INFO', '创建事件', { username: req.user, eventId: id });
    res.json(event);
  } catch (e) {
    log('ERROR', '创建事件失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新事件
router.put('/:id', async (req, res) => {
  try {
    const { title, description, startTime, endTime, allDay, color, noteId, reminderEmail, reminderBrowser, reminderCaldav, recurrence, recurrenceEnd } = req.body;

    const existing = await getConnection().get(
      'SELECT * FROM events WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    if (!existing) {
      return res.status(404).json({ error: '事件不存在' });
    }

    await getConnection().run(
      `UPDATE events SET
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       startTime = COALESCE(?, startTime),
       endTime = COALESCE(?, endTime),
       allDay = COALESCE(?, allDay),
       color = COALESCE(?, color),
       noteId = COALESCE(?, noteId),
       reminderEmail = COALESCE(?, reminderEmail),
       reminderBrowser = COALESCE(?, reminderBrowser),
       reminderCaldav = COALESCE(?, reminderCaldav),
       recurrence = COALESCE(?, recurrence),
       recurrenceEnd = COALESCE(?, recurrenceEnd),
       updatedAt = ?
       WHERE id = ? AND username = ?`,
      [
        title !== undefined ? title.trim() : null,
        description !== undefined ? description : null,
        startTime !== undefined ? Math.floor(new Date(startTime).getTime() / 1000) : null,
        endTime !== undefined ? (endTime ? Math.floor(new Date(endTime).getTime() / 1000) : null) : null,
        allDay !== undefined ? (allDay ? 1 : 0) : null,
        color !== undefined ? color : null,
        noteId !== undefined ? noteId : null,
        reminderEmail !== undefined ? (reminderEmail ? 1 : 0) : null,
        reminderBrowser !== undefined ? (reminderBrowser ? 1 : 0) : null,
        reminderCaldav !== undefined ? (reminderCaldav ? 1 : 0) : null,
        recurrence !== undefined ? recurrence : null,
        recurrenceEnd !== undefined ? (recurrenceEnd ? Math.floor(new Date(recurrenceEnd).getTime() / 1000) : null) : null,
        Math.floor(Date.now() / 1000),
        req.params.id,
        req.user
      ]
    );

    const event = await getConnection().get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    log('INFO', '更新事件', { username: req.user, eventId: req.params.id });
    res.json(event);
  } catch (e) {
    log('ERROR', '更新事件失败', { username: req.user, eventId: req.params.id, error: e.message });
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除事件
router.delete('/:id', async (req, res) => {
  try {
    const result = await getConnection().run(
      'DELETE FROM events WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: '事件不存在' });
    }

    log('INFO', '删除事件', { username: req.user, eventId: req.params.id });
    res.json({ status: 'ok' });
  } catch (e) {
    log('ERROR', '删除事件失败', { username: req.user, eventId: req.params.id, error: e.message });
    res.status(500).json({ error: '删除失败' });
  }
});

// 获取指定日期的待办事项和事件
  router.get('/calendar/day/:date', async (req, res) => {
    try {
      const dateStr = req.params.date;

      // 验证日期格式
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ error: '无效的日期格式' });
      }

      const dayStart = new Date(dateStr);
      if (isNaN(dayStart.getTime())) {
        return res.status(400).json({ error: '无效的日期' });
      }

      dayStart.setHours(0, 0, 0, 0);
      const dayStartTime = Math.floor(dayStart.getTime() / 1000);

      const dayEnd = new Date(dateStr);
      dayEnd.setHours(23, 59, 59, 999);
      const dayEndTime = Math.floor(dayEnd.getTime() / 1000);

      const year = dayStart.getFullYear();
      const month = dayStart.getMonth();

      console.log('[Calendar API] 查询日期:', dateStr);
      console.log('[Calendar API] 时间范围 (秒):', dayStartTime, '-', dayEndTime);

      // 获取整个月的事件（用于展开重复事件）
      const monthStart = Math.floor(new Date(year, month, 1).getTime() / 1000);
      const monthEnd = Math.floor(new Date(year, month + 1, 0, 23, 59, 59).getTime() / 1000);

      // 使用 Promise.all 并行查询
      const [todos, rawEvents, notes] = await Promise.all([
        // 获取当天的待办事项（只查询有dueDate的）
        getConnection().all(
          `SELECT * FROM todos WHERE username = ? AND dueDate IS NOT NULL AND dueDate >= ? AND dueDate <= ?
           ORDER BY priority DESC, dueDate ASC`,
          [req.user, dayStartTime, dayEndTime]
        ).catch(() => []),

        // 获取整个月的事件（用于展开重复事件）
        getConnection().all(
          `SELECT * FROM events WHERE username = ? 
           AND (
             -- 当前月份的事件
             ((startTime >= ? AND startTime <= ?) OR (endTime >= ? AND endTime <= ?) OR (startTime <= ? AND endTime >= ?))
             OR
             -- 重复事件（无论开始时间）
             (recurrence IS NOT NULL AND recurrence != '')
           )
           ORDER BY startTime ASC`,
          [req.user, monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd]
        ).catch(() => []),

        // 获取当天修改的笔记（注意：updatedAt 是毫秒时间戳）
        getConnection().all(
          `SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND deleted = 0
           AND updatedAt >= ? AND updatedAt <= ?
           ORDER BY updatedAt DESC`,
          [req.user, dayStartTime * 1000, dayEndTime * 1000]
        ).catch(() => [])
      ]);

      // 展开重复事件
      const expandedEvents = expandRecurringEvents(rawEvents || [], year, month);
        console.log('[Calendar API] 展开前的事件数量:', rawEvents?.length);
        console.log('[Calendar API] 展开后的事件数量:', expandedEvents.length);
        expandedEvents.forEach((event, index) => {
          const eventDate = new Date(event.startTime * 1000);
          console.log('[Calendar API] 事件', index + 1, ':', event.title, eventDate.toISOString().split('T')[0], 'isRecurringInstance:', event.isRecurringInstance);
        });


      // 过滤出当天的事件
      const dayEvents = expandedEvents.filter(event => {
        const eventDate = new Date(event.startTime * 1000);
        const year = eventDate.getFullYear();
        const month = String(eventDate.getMonth() + 1).padStart(2, '0');
        const day = String(eventDate.getDate()).padStart(2, '0');
        const eventDateStr = `${year}-${month}-${day}`;
        return eventDateStr === dateStr;
      });

      res.json({ todos: todos || [], events: dayEvents || [], notes: notes || [] });
    } catch (e) {
      log('ERROR', '获取日历数据失败', { username: req.user, date: req.params.date, error: e.message, stack: e.stack });
      res.status(500).json({ error: '获取失败', message: e.message });
    }
  });

  /**
   * 展开重复事件
   * @param {Array} events - 原始事件列表
   * @param {number} year - 年份
   * @param {number} month - 月份（0-11）
   * @returns {Array} - 展开后的事件列表
   */
  function expandRecurringEvents(events, year, month) {
    const expanded = [];
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

    events.forEach(event => {
      if (!event.recurrence) {
        // 非重复事件，直接添加
        expanded.push(event);
        return;
      }

      try {
        const recurrence = typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence;
        if (!recurrence || !recurrence.type) {
          expanded.push(event);
          return;
        }

        const startDate = new Date(event.startTime * 1000);
        const endDate = event.recurrenceEnd ? new Date(event.recurrenceEnd * 1000) : null;

        // 如果是每周重复但没有指定 daysOfWeek，使用事件本身的星期几
        if (recurrence.type === 'weekly' && !recurrence.daysOfWeek) {
          recurrence.daysOfWeek = [startDate.getDay()];
        }

        // 为每次重复生成一个事件实例
        let current = new Date(startDate);
        let breakLoop = false;

        // 如果开始日期在月份之前，跳到月份内的第一个重复实例
        if (current < monthStart) {
          // 根据重复类型计算需要前进多少个周期
          let periodMs = 0;
          switch (recurrence.type) {
            case 'daily':
              periodMs = 24 * 60 * 60 * 1000 * (recurrence.interval || 1);
              break;
            case 'weekly':
              periodMs = 7 * 24 * 60 * 60 * 1000 * (recurrence.interval || 1);
              break;
            case 'monthly':
              // 月度重复需要特殊处理，使用月份差计算
              const yearDiff = monthStart.getFullYear() - current.getFullYear();
              const monthDiff = monthStart.getMonth() - current.getMonth();
              const totalMonths = yearDiff * 12 + monthDiff;
              const periodsToSkip = Math.max(0, totalMonths);
              current.setMonth(current.getMonth() + periodsToSkip * (recurrence.interval || 1));
              periodMs = 0; // 标记为已处理
              break;
            case 'yearly':
              periodMs = 365 * 24 * 60 * 60 * 1000 * (recurrence.interval || 1);
              break;
              case 'lunar_monthly':
              case 'lunar_yearly':
                // 农历重复类型,不使用简单的periodMs计算,将在循环中逐步跳过
                periodMs = 0;
                break;

          }

          if (periodMs > 0) {
            const periodsToSkip = Math.ceil((monthStart - current) / periodMs);
            current.setTime(current.getTime() + periodsToSkip * periodMs);
          }
        }

        while ((!endDate || current <= endDate) && current <= monthEnd) {
          // 对于每周重复，只在指定的星期几添加
          let shouldAdd = true;
          if (recurrence.type === 'weekly' && recurrence.daysOfWeek) {
            shouldAdd = recurrence.daysOfWeek.includes(current.getDay());
          }

          if (shouldAdd) {
            // 创建事件实例
            expanded.push({
              ...event,
              // 保留原始 ID，添加实例时间戳作为标识
              _originalId: event.id,
              _instanceTime: Math.floor(current.getTime() / 1000),
              isRecurringInstance: true,
              startTime: Math.floor(current.getTime() / 1000),
              endTime: event.endTime ?
                Math.floor(current.getTime() / 1000 + (event.endTime - event.startTime)) :
                null
            });
          }

          // 根据重复类型前进
          switch (recurrence.type) {
            case 'daily':
              current.setDate(current.getDate() + (recurrence.interval || 1));
              break;
            case 'weekly':
              current.setDate(current.getDate() + 1); // 每周重复，每天前进，检查是否是指定的星期几
              break;
            case 'monthly':
              current.setMonth(current.getMonth() + (recurrence.interval || 1));
              break;
            case 'yearly':
              current.setFullYear(current.getFullYear() + (recurrence.interval || 1));
              break;
            case 'lunar_monthly':
            case 'lunar_yearly':
              const { getNextLunarDate, getNextLunarMonthDate } = require('../utils/lunarHelper');
              if (recurrence.type === 'lunar_yearly') {
                current = getNextLunarDate(current);
              } else if (recurrence.type === 'lunar_monthly') {
                current = getNextLunarMonthDate(current);
              }
              break;

          }

          if (breakLoop) break;
        }
      } catch (e) {
        console.error('展开重复事件失败:', event, e);
        expanded.push(event);
      }
    });

    return expanded;
  }


module.exports = router;
