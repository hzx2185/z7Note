const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const { importFromICS } = require('../utils/icsExport');

const router = express.Router();

/**
 * 获取用户的所有订阅
 */
router.get('/', async (req, res) => {
  try {
    const subscriptions = await getConnection().all(
      'SELECT * FROM calendar_subscriptions WHERE username = ? ORDER BY createdAt DESC',
      [req.user]
    );
    res.json(subscriptions);
  } catch (e) {
    log('ERROR', '获取订阅失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * 添加新订阅
 */
router.post('/', async (req, res) => {
  try {
    const { name, url, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '订阅名称不能为空' });
    }

    if (!url || !url.trim()) {
      return res.status(400).json({ error: '订阅URL不能为空' });
    }

    // 验证URL格式
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: '无效的URL格式' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await getConnection().run(
      `INSERT INTO calendar_subscriptions (id, username, name, url, color, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user,
        name.trim(),
        url.trim(),
        color || '#6366f1',
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000)
      ]
    );

    log('INFO', '添加订阅', { username: req.user, subscriptionId: id, name: name.trim() });
    
    const subscription = await getConnection().get('SELECT * FROM calendar_subscriptions WHERE id = ?', [id]);
    res.json(subscription);
  } catch (e) {
    log('ERROR', '添加订阅失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '添加失败' });
  }
});

/**
 * 更新订阅
 */
router.put('/:id', async (req, res) => {
  try {
    const { name, url, color, enabled } = req.body;

    const existing = await getConnection().get(
      'SELECT * FROM calendar_subscriptions WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    if (!existing) {
      return res.status(404).json({ error: '订阅不存在' });
    }

    await getConnection().run(
      `UPDATE calendar_subscriptions SET
       name = COALESCE(?, name),
       url = COALESCE(?, url),
       color = COALESCE(?, color),
       enabled = COALESCE(?, enabled),
       updatedAt = ?
       WHERE id = ? AND username = ?`,
      [
        name !== undefined ? name.trim() : null,
        url !== undefined ? url.trim() : null,
        color !== undefined ? color : null,
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        Math.floor(Date.now() / 1000),
        req.params.id,
        req.user
      ]
    );

    log('INFO', '更新订阅', { username: req.user, subscriptionId: req.params.id });
    
    const subscription = await getConnection().get('SELECT * FROM calendar_subscriptions WHERE id = ?', [req.params.id]);
    res.json(subscription);
  } catch (e) {
    log('ERROR', '更新订阅失败', { username: req.user, subscriptionId: req.params.id, error: e.message });
    res.status(500).json({ error: '更新失败' });
  }
});

/**
 * 删除订阅
 */
router.delete('/:id', async (req, res) => {
  try {
    // 删除订阅
    const result = await getConnection().run(
      'DELETE FROM calendar_subscriptions WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: '订阅不存在' });
    }

    // 删除该订阅的所有事件
    await getConnection().run(
      'DELETE FROM events WHERE subscriptionId = ? AND username = ?',
      [req.params.id, req.user]
    );

    log('INFO', '删除订阅', { username: req.user, subscriptionId: req.params.id });
    res.json({ status: 'ok' });
  } catch (e) {
    log('ERROR', '删除订阅失败', { username: req.user, subscriptionId: req.params.id, error: e.message });
    res.status(500).json({ error: '删除失败' });
  }
});

/**
 * 手动同步订阅
 */
router.post('/:id/sync', async (req, res) => {
  try {
    const subscription = await getConnection().get(
      'SELECT * FROM calendar_subscriptions WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    if (!subscription) {
      return res.status(404).json({ error: '订阅不存在' });
    }

    // 获取ICS内容
    const response = await fetch(subscription.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; z7Note Calendar Sync)'
      },
      timeout: 30000
    });

    if (!response.ok) {
      throw new Error(`获取ICS失败: ${response.status}`);
    }

    const icsContent = await response.text();
    const events = importFromICS(icsContent);

    // 删除该订阅的旧事件
    await getConnection().run(
      'DELETE FROM events WHERE subscriptionId = ? AND username = ?',
      [req.params.id, req.user]
    );

    // 插入新事件
    let importedCount = 0;
    for (const event of events) {
      try {
        const id = `sub_${req.params.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        await getConnection().run(
          `INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, subscriptionId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            req.user,
            event.title || '未命名事件',
            event.description || '',
            event.startTime || Math.floor(Date.now() / 1000),
            event.endTime || null,
            event.allDay ? 1 : 0,
            subscription.color || '#6366f1',
            req.params.id,
            Math.floor(Date.now() / 1000),
            Math.floor(Date.now() / 1000)
          ]
        );
        importedCount++;
      } catch (err) {
        log('ERROR', '导入单个事件失败', { username: req.user, event, error: err.message });
      }
    }

    // 更新最后同步时间
    await getConnection().run(
      'UPDATE calendar_subscriptions SET lastSync = ?, updatedAt = ? WHERE id = ?',
      [Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), req.params.id]
    );

    log('INFO', '同步订阅', {
      username: req.user,
      subscriptionId: req.params.id,
      imported: importedCount
    });

    res.json({
      success: true,
      imported: importedCount
    });
  } catch (e) {
    log('ERROR', '同步订阅失败', { username: req.user, subscriptionId: req.params.id, error: e.message });
    res.status(500).json({ error: '同步失败: ' + e.message });
  }
});

module.exports = router;
