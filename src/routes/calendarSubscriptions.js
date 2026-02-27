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
 * 核心同步逻辑 (导出供定时任务使用)
 */
async function syncSubscription(subscriptionId, username) {
  const subscription = await getConnection().get(
    'SELECT * FROM calendar_subscriptions WHERE id = ? AND username = ?',
    [subscriptionId, username]
  );

  if (!subscription) {
    throw new Error('订阅不存在');
  }

  // 自动修正协议：webcal:// -> https://
  let fetchUrl = subscription.url;
  if (fetchUrl.startsWith('webcal://')) {
    fetchUrl = 'https://' + fetchUrl.substring(9);
  }

  log('INFO', '开始同步订阅内容', { url: fetchUrl, subscriptionId });

  // 获取ICS内容
  let icsContent;
  try {
    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/calendar, text/plain, */*',
        'Connection': 'keep-alive'
      },
      redirect: 'follow',
      timeout: 30000
    });

    if (!response.ok) {
      throw new Error(`获取ICS失败: ${response.status}`);
    }
    icsContent = await response.text();
  } catch (fetchErr) {
    log('WARN', 'Fetch同步失败，尝试备用方案(curl)', { error: fetchErr.message });
    const { execSync } = require('child_process');
    try {
      icsContent = execSync(`curl -L -s -A "Mozilla/5.0" "${fetchUrl}"`, { encoding: 'utf8', timeout: 30000 });
      if (!icsContent || !icsContent.includes('BEGIN:VCALENDAR')) {
        throw new Error('curl 返回内容无效');
      }
    } catch (curlErr) {
      throw new Error(`所有同步方案均失败: ${fetchErr.message} | ${curlErr.message}`);
    }
  }

  const events = importFromICS(icsContent);
  const db = getConnection();
  await db.run('BEGIN TRANSACTION');

  try {
    // 1. 删除该订阅的所有旧事件
    await db.run(
      'DELETE FROM events WHERE subscriptionId = ? AND username = ?',
      [subscriptionId, username]
    );

    // 2. 批量插入新事件
    let importedCount = 0;
    const now = Math.floor(Date.now() / 1000);
    
    for (const event of events) {
      const eventUid = event.uid || `idx_${importedCount}`;
      const id = `sub_${subscriptionId}_${eventUid}`;
      
      await db.run(
        `INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, subscriptionId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          username,
          event.title || '未命名事件',
          event.description || '',
          event.startTime || now,
          event.endTime || null,
          event.allDay ? 1 : 0,
          subscription.color || '#6366f1',
          subscriptionId,
          now,
          now
        ]
      );
      importedCount++;
    }

    // 3. 更新最后同步时间
    await db.run(
      'UPDATE calendar_subscriptions SET lastSync = ?, updatedAt = ? WHERE id = ?',
      [now, now, subscriptionId]
    );

    await db.run('COMMIT');
    return importedCount;
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

/**
 * 手动同步订阅
 */
router.post('/:id/sync', async (req, res) => {
  try {
    const importedCount = await syncSubscription(req.params.id, req.user);
    
    log('INFO', '手动同步订阅成功', {
      username: req.user,
      subscriptionId: req.params.id,
      imported: importedCount
    });

    res.json({
      success: true,
      imported: importedCount
    });
  } catch (e) {
    console.error('[Sync Error]', e);
    log('ERROR', '手动同步订阅失败', { username: req.user, subscriptionId: req.params.id, error: e.message });
    res.status(500).json({ error: '同步失败: ' + e.message });
  }
});

module.exports = { router, syncSubscription };
