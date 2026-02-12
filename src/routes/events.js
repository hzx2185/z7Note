const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');

const router = express.Router();

// 获取事件列表
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = 'SELECT * FROM events WHERE username = ?';
    const params = [req.user];

    if (startDate && endDate) {
      // 查询在指定时间范围内的事件
      query += ' AND ((startTime >= ? AND startTime <= ?) OR (endTime >= ? AND endTime <= ?) OR (startTime <= ? AND endTime >= ?))';
      params.push(
        parseInt(startDate),
        parseInt(endDate),
        parseInt(startDate),
        parseInt(endDate),
        parseInt(startDate),
        parseInt(endDate)
      );
    }

    query += ' ORDER BY startTime ASC';

    const events = await getConnection().all(query, params);
    res.json(events);
  } catch (e) {
    log('ERROR', '获取事件失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
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
    const { title, description, startTime, endTime, allDay, color, noteId } = req.body;

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
      `INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, noteId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const { title, description, startTime, endTime, allDay, color, noteId } = req.body;

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

    console.log('[Calendar API] 查询日期:', dateStr);
    console.log('[Calendar API] 服务器时区偏移（分钟）:', dayStart.getTimezoneOffset());
    console.log('[Calendar API] 时间范围 (秒):', dayStartTime, '-', dayEndTime);
    console.log('[Calendar API] 时间范围 (毫秒):', dayStartTime * 1000, '-', dayEndTime * 1000);

    console.log('[Calendar API] 查询日期:', dateStr);
    console.log('[Calendar API] 时间范围 (秒):', dayStartTime, '-', dayEndTime);
    console.log('[Calendar API] 时间范围 (毫秒):', dayStartTime * 1000, '-', dayEndTime * 1000);

    // 使用 Promise.all 并行查询
    const [todos, events, notes] = await Promise.all([
      // 获取当天的待办事项（只查询有dueDate的）
      getConnection().all(
        `SELECT * FROM todos WHERE username = ? AND dueDate IS NOT NULL AND dueDate >= ? AND dueDate <= ?
         ORDER BY priority DESC, dueDate ASC`,
        [req.user, dayStartTime, dayEndTime]
      ).catch(() => []),

      // 获取当天的事件
      getConnection().all(
        `SELECT * FROM events WHERE username = ? AND ((startTime >= ? AND startTime <= ?) OR (endTime >= ? AND endTime <= ?) OR (startTime <= ? AND endTime >= ?))
         ORDER BY startTime ASC`,
        [req.user, dayStartTime, dayEndTime, dayStartTime, dayEndTime, dayStartTime, dayEndTime]
      ).catch(() => []),

      // 获取当天修改的笔记（注意：updatedAt 是毫秒时间戳）
      getConnection().all(
        `SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND deleted = 0
         AND updatedAt >= ? AND updatedAt <= ?
         ORDER BY updatedAt DESC`,
        [req.user, dayStartTime * 1000, dayEndTime * 1000]
      ).catch(() => [])
    ]);

    console.log('[Calendar API] 返回数据:', {
      todos: todos?.length || 0,
      events: events?.length || 0,
      notes: notes?.length || 0
    });

    res.json({ todos: todos || [], events: events || [], notes: notes || [] });
  } catch (e) {
    log('ERROR', '获取日历数据失败', { username: req.user, date: req.params.date, error: e.message, stack: e.stack });
    res.status(500).json({ error: '获取失败', message: e.message });
  }
});

module.exports = router;
