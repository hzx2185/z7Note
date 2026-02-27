const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const { broadcast } = require('./ws');

const router = express.Router();

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

    const todos = await getConnection().all(query, params);
    res.json(todos);
  } catch (e) {
    log('ERROR', '获取待办事项失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取单个待办事项
router.get('/api/todos/:id', async (req, res) => {
  try {
    const todo = await getConnection().get(
      'SELECT * FROM todos WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );
    if (!todo) return res.status(404).json({ error: '待办事项不存在' });
    res.json(todo);
  } catch (e) {
    log('ERROR', '获取待办事项失败', { username: req.user, todoId: req.params.id, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 创建待办事项
router.post('/api/todos', async (req, res) => {
  try {
    const { title, description, completed, priority, dueDate, noteId, reminderEmail, reminderBrowser } = req.body;

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

    if (priority !== undefined && ![1, 2, 3].includes(parseInt(priority))) {
      return res.status(400).json({ error: '优先级必须是1、2或3' });
    }

    if (dueDate && isNaN(parseInt(dueDate))) {
      return res.status(400).json({ error: '无效的截止日期' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await getConnection().run(
      `INSERT INTO todos (id, username, title, description, completed, priority, dueDate, noteId, reminderEmail, reminderBrowser, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user,
        title.trim(),
        description ? description.trim() : '',
        completed ? 1 : 0,
        priority !== undefined ? parseInt(priority) : 1,
        dueDate ? parseInt(dueDate) : null,
        noteId || null,
        reminderEmail !== undefined ? (reminderEmail ? 1 : 0) : 0,
        reminderBrowser !== undefined ? (reminderBrowser ? 1 : 0) : 1,
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000)
      ]
    );

    const todo = await getConnection().get('SELECT * FROM todos WHERE id = ?', [id]);
    log('INFO', '创建待办事项', { username: req.user, todoId: id });
    
    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });
    
    res.json(todo);
  } catch (e) {
    log('ERROR', '创建待办事项失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新待办事项
router.put('/api/todos/:id', async (req, res) => {
  try {
    const existing = await getConnection().get(
      'SELECT * FROM todos WHERE id = ? AND username = ?',
      [req.params.id, req.user]
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
      dueDate: (v) => v !== undefined ? (v ? parseInt(v) : null) : undefined,
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

      params.push(req.params.id, req.user);
      
      const query = `UPDATE todos SET ${updates.join(', ')} WHERE id = ? AND username = ?`;
      await getConnection().run(query, params);
    }

    const todo = await getConnection().get('SELECT * FROM todos WHERE id = ?', [req.params.id]);
    log('INFO', '更新待办事项', { username: req.user, todoId: req.params.id });
    
    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });
    
    res.json(todo);
  } catch (e) {
    log('ERROR', '更新待办事项失败', { username: req.user, todoId: req.params.id, error: e.message });
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除待办事项
router.delete('/api/todos/:id', async (req, res) => {
  try {
    const result = await getConnection().run(
      'DELETE FROM todos WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: '待办事项不存在' });
    }

    log('INFO', '删除待办事项', { username: req.user, todoId: req.params.id });
    
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
    const todo = await getConnection().get(
      'SELECT * FROM todos WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    if (!todo) {
      return res.status(404).json({ error: '待办事项不存在' });
    }

    const newCompleted = todo.completed === 0 ? 1 : 0;
    await getConnection().run(
      'UPDATE todos SET completed = ?, updatedAt = ? WHERE id = ? AND username = ?',
      [newCompleted, Math.floor(Date.now() / 1000), req.params.id, req.user]
    );

    const updated = await getConnection().get('SELECT * FROM todos WHERE id = ?', [req.params.id]);
    log('INFO', '切换待办事项状态', { username: req.user, todoId: req.params.id, completed: newCompleted });
    
    broadcast('calendar_update', { username: req.user, type: 'sync' }, { targetUsername: req.user });
    
    res.json(updated);
  } catch (e) {
    log('ERROR', '切换待办事项状态失败', { username: req.user, todoId: req.params.id, error: e.message });
    res.status(500).json({ error: '操作失败' });
  }
});

module.exports = router;
