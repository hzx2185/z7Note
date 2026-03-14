const express = require('express');
const db = require('../db/client');
const log = require('../utils/logger');
const { broadcast } = require('./ws');
const TimeHelper = require('../utils/timeHelper');
const { getCalendarIdCandidates, scopeExternalCalendarId, toClientCalendarId } = require('../utils/calendarIds');

const router = express.Router();

function mapTodoForClient(username, todo) {
  if (!todo) return todo;
  return { ...todo, id: toClientCalendarId(username, todo.id) };
}

// 获取待办事项列表
router.get('/api/todos', async (req, res) => {
  try {
    const { completed, priority, startDate, endDate } = req.query;

    let query = 'SELECT * FROM todos WHERE username = ?';
    const params = [req.user];

    if (completed !== undefined) {
      query += ' AND completed = ?';
      params.push(completed === 'true' ? 1 : 0);
    }

    if (priority) {
      query += ' AND priority = ?';
      params.push(parseInt(priority));
    }

    if (startDate) {
      query += ' AND dueDate IS NOT NULL AND dueDate >= ?';
      params.push(parseInt(startDate));
    }

    if (endDate) {
      query += ' AND dueDate IS NOT NULL AND dueDate <= ?';
      params.push(parseInt(endDate));
    }

    query += ' ORDER BY priority DESC, dueDate ASC, createdAt DESC';

    const todos = await db.queryAll(query, params);
    res.json(todos.map(todo => mapTodoForClient(req.user, todo)));
  } catch (e) {
    log('ERROR', '获取待办事项失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取单个待办事项
router.get('/api/todos/:id', async (req, res) => {
  try {
    const candidates = getCalendarIdCandidates(req.user, req.params.id);
    const placeholders = candidates.map(() => '?').join(',');
    const todo = await db.queryOne(
      `SELECT * FROM todos WHERE username = ? AND id IN (${placeholders}) LIMIT 1`,
      [req.user, ...candidates]
    );
    if (!todo) return res.status(404).json({ error: '待办事项不存在' });
    res.json(mapTodoForClient(req.user, todo));
  } catch (e) {
    log('ERROR', '获取待办事项失败', { username: req.user, todoId: req.params.id, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 创建待办事项
router.post('/api/todos', async (req, res) => {
  try {
    const { title, description, completed, priority, dueDate, startTime, allDay, noteId, reminderEmail, reminderBrowser } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: '标题不能为空' });
    }

    if (title.trim().length > 200) {
      return res.status(400).json({ error: '标题长度不能超过200个字符' });
    }

    if (description && description.length > 1000) {
      return res.status(400).json({ error: '描述长度不能超过1000个字符' });
    }

    if (priority !== undefined && ![1, 2, 3].includes(parseInt(priority))) {
      return res.status(400).json({ error: '优先级必须是1、2或3' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await db.execute(
      `INSERT INTO todos (id, username, title, description, completed, priority, dueDate, startTime, allDay, noteId, reminderEmail, reminderBrowser, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user,
        title.trim(),
        description ? description.trim() : '',
        completed ? 1 : 0,
        priority !== undefined ? parseInt(priority) : 1,
        TimeHelper.parseToTs(dueDate),
        TimeHelper.parseToTs(startTime),
        allDay !== undefined ? (allDay ? 1 : 0) : 1,
        noteId || null,
        reminderEmail !== undefined ? (reminderEmail ? 1 : 0) : 0,
        reminderBrowser !== undefined ? (reminderBrowser ? 1 : 0) : 1,
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000)
      ]
    );

    const todo = await db.queryOne('SELECT * FROM todos WHERE id = ? AND username = ?', [id, req.user]);
    log('INFO', '创建待办事项', { username: req.user, todoId: id });

    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });

    res.json(mapTodoForClient(req.user, todo));
  } catch (e) {
    log('ERROR', '创建待办事项失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新待办事项
router.put('/api/todos/:id', async (req, res) => {
  try {
    const candidates = getCalendarIdCandidates(req.user, req.params.id);
    const placeholders = candidates.map(() => '?').join(',');
    const existing = await db.queryOne(
      `SELECT * FROM todos WHERE username = ? AND id IN (${placeholders}) LIMIT 1`,
      [req.user, ...candidates]
    );

    if (!existing) {
      return res.status(404).json({ error: '待办事项不存在' });
    }

    const updates = [];
    const params = [];

    const fields = {
      title: (v) => v !== undefined ? v.trim() : undefined,
      description: (v) => v,
      completed: (v) => v !== undefined ? (v ? 1 : 0) : undefined,
      priority: (v) => v !== undefined ? parseInt(v) : undefined,
      dueDate: TimeHelper.parseToTs,
      startTime: TimeHelper.parseToTs,
      allDay: (v) => v !== undefined ? (v ? 1 : 0) : undefined,
      noteId: (v) => v !== undefined ? v : undefined,
      reminderEmail: (v) => v !== undefined ? (v ? 1 : 0) : undefined,
      reminderBrowser: (v) => v !== undefined ? (v ? 1 : 0) : undefined
    };

    for (const [key, parser] of Object.entries(fields)) {
      if (req.body[key] !== undefined) {
        const val = parser(req.body[key]);
        if (val !== undefined) {
          updates.push(`${key} = ?`);
          params.push(val);
        }
      }
    }

    if (updates.length > 0) {
      updates.push('updatedAt = ?');
      params.push(Math.floor(Date.now() / 1000));
      params.push(existing.id, req.user);

      const query = `UPDATE todos SET ${updates.join(', ')} WHERE id = ? AND username = ?`;
      await db.execute(query, params);
    }

    const todo = await db.queryOne('SELECT * FROM todos WHERE id = ? AND username = ?', [existing.id, req.user]);
    log('INFO', '更新待办事项', { username: req.user, todoId: existing.id });

    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });

    res.json(mapTodoForClient(req.user, todo));
  } catch (e) {
    log('ERROR', '更新待办事项失败', { username: req.user, todoId: req.params.id, error: e.message });
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除待办事项
router.delete('/api/todos/:id', async (req, res) => {
  const now = Math.floor(Date.now() / 1000);

  try {
    const candidates = getCalendarIdCandidates(req.user, req.params.id);
    const placeholders = candidates.map(() => '?').join(',');
    const todo = await db.queryOne(
      `SELECT id FROM todos WHERE username = ? AND id IN (${placeholders}) LIMIT 1`,
      [req.user, ...candidates]
    );

    if (!todo) {
      return res.status(404).json({ error: '待办事项不存在' });
    }

    await db.execute(
      'INSERT INTO deleted_items (id, username, item_id, type, deletedAt) VALUES (?, ?, ?, ?, ?)',
      [Date.now().toString(36) + Math.random().toString(36).slice(2), req.user, toClientCalendarId(req.user, todo.id), 'todo', now]
    );

    await db.execute('DELETE FROM todos WHERE id = ? AND username = ?', [todo.id, req.user]);

    log('INFO', '删除待办事项', { username: req.user, todoId: todo.id });

    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });

    res.json({ status: 'ok' });
  } catch (e) {
    log('ERROR', '删除待办事项失败', { username: req.user, todoId: req.params.id, error: e.message });
    res.status(500).json({ error: '删除失败' });
  }
});

// 切换待办事项完成状态
router.patch('/api/todos/:id/toggle', async (req, res) => {
  try {
    const candidates = getCalendarIdCandidates(req.user, req.params.id);
    const placeholders = candidates.map(() => '?').join(',');
    const todo = await db.queryOne(
      `SELECT * FROM todos WHERE username = ? AND id IN (${placeholders}) LIMIT 1`,
      [req.user, ...candidates]
    );

    if (!todo) {
      return res.status(404).json({ error: '待办事项不存在' });
    }

    const newCompleted = todo.completed === 0 ? 1 : 0;
    await db.execute(
      'UPDATE todos SET completed = ?, updatedAt = ? WHERE id = ? AND username = ?',
      [newCompleted, Math.floor(Date.now() / 1000), todo.id, req.user]
    );

    const updated = await db.queryOne('SELECT * FROM todos WHERE id = ? AND username = ?', [todo.id, req.user]);
    log('INFO', '切换待办事项状态', { username: req.user, todoId: todo.id, completed: newCompleted });

    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });

    res.json(mapTodoForClient(req.user, updated));
  } catch (e) {
    log('ERROR', '切换待办事项状态失败', { username: req.user, todoId: req.params.id, error: e.message });
    res.status(500).json({ error: '操作失败' });
  }
});

// 导入待办事项
router.post('/api/todos/import', async (req, res) => {
  try {
    const { todosData } = req.body;
    if (!todosData || !todosData.todos || !Array.isArray(todosData.todos)) {
      return res.status(400).json({ error: '无效的待办数据格式' });
    }

    const username = req.user;
    const now = Math.floor(Date.now() / 1000);

    let imported = 0;
    let skipped = 0;
    let updated = 0;

    for (const todo of todosData.todos) {
      if (!todo.title) continue;

      let existing;
      const scopedTodoId = todo.id ? scopeExternalCalendarId(username, todo.id) : null;
      if (todo.id) {
        existing = await db.queryOne('SELECT id FROM todos WHERE id IN (?, ?) AND username = ?', [todo.id, scopedTodoId, username]);
      }

      const dueDateTs = TimeHelper.parseToTs(todo.dueDate);

      if (!existing && todo.title && dueDateTs) {
        existing = await db.queryOne(
          'SELECT id FROM todos WHERE username = ? AND title = ? AND dueDate = ?',
          [username, todo.title, dueDateTs]
        );
      }

      if (existing) {
        await db.execute(
          'UPDATE todos SET title=?, description=?, priority=?, dueDate=?, completed=?, updatedAt=? WHERE id=? AND username=?',
          [todo.title, todo.description || '', todo.priority || 5, dueDateTs, todo.completed ? 1 : 0, now, existing.id, username]
        );
        updated++;
        skipped++;
      } else {
        const todoId = todo.id ? scopedTodoId : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await db.execute(
          'INSERT INTO todos (id, username, title, description, priority, dueDate, completed, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
          [todoId, username, todo.title, todo.description || '', todo.priority || 5, dueDateTs, todo.completed ? 1 : 0, now, now]
        );
        imported++;
      }
    }

    broadcast('calendar_update', { username, type: 'sync' }, { targetUsername: username });
    log('INFO', '导入待办事项', { username, imported, skipped, updated });
    res.json({ success: true, imported, skipped, updated });
  } catch (e) {
    log('ERROR', '导入待办事项失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '导入失败: ' + e.message });
  }
});

module.exports = router;
