/**
 * 提醒设置API路由
 */

const express = require('express');
const { getUserReminderSettings, updateUserReminderSettings, checkAndSendPendingReminders } = require('../services/reminderService');
const log = require('../utils/logger');

const router = express.Router();

/**
 * 获取用户提醒设置
 */
router.get('/', async (req, res) => {
  try {
    const settings = await getUserReminderSettings(req.user);
    res.json(settings);
  } catch (e) {
    log('ERROR', '获取提醒设置失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * 更新用户提醒设置
 */
router.put('/', async (req, res) => {
  try {
    const settings = await updateUserReminderSettings(req.user, req.body);
    res.json(settings);
  } catch (e) {
    log('ERROR', '更新提醒设置失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '更新失败' });
  }
});

/**
 * 手动触发提醒检查（测试用）
 */
router.post('/check', async (req, res) => {
  try {
    await checkAndSendPendingReminders();
    res.json({ status: 'ok', message: '提醒检查完成' });
  } catch (e) {
    log('ERROR', '手动触发提醒检查失败', { error: e.message });
    res.status(500).json({ error: '检查失败' });
  }
});

/**
 * 获取提醒历史
 */
router.get('/history', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status } = req.query;

    const { getConnection } = require('../db/connection');
    const db = getConnection();

    let query = 'SELECT * FROM reminder_history WHERE username = ?';
    const params = [req.user];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY reminder_time DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const history = await db.all(query, params);
    res.json(history);
  } catch (e) {
    log('ERROR', '获取提醒历史失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * 清除提醒历史
 */
router.delete('/history', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const { getConnection } = require('../db/connection');
    const db = getConnection();

    const cutoffTime = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

    const result = await db.run(
      'DELETE FROM reminder_history WHERE username = ? AND reminder_time < ?',
      [req.user, cutoffTime]
    );

    log('INFO', '清除提醒历史', { username: req.user, deleted: result.changes });
    res.json({ status: 'ok', deleted: result.changes });
  } catch (e) {
    log('ERROR', '清除提醒历史失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '清除失败' });
  }
});

module.exports = router;
