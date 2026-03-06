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

/**
 * 导入提醒设置
 */
router.post('/import', async (req, res) => {
  try {
    const { remindersData } = req.body;
    if (!remindersData || !remindersData.reminders) {
      return res.status(400).json({ error: '无效的提醒数据格式' });
    }

    const { getConnection } = require('../db/connection');
    const db = getConnection();
    const username = req.user;
    const reminders = remindersData.reminders;

    // 检查是否已存在提醒设置
    const existing = await db.get('SELECT * FROM reminder_settings WHERE username = ?', [username]);

    if (existing) {
      // 更新现有设置
      await db.run(`
        UPDATE reminder_settings SET
          event_reminder_enabled = ?,
          todo_reminder_enabled = ?,
          reminder_advance_days = ?,
          reminder_advance_hours = ?,
          reminder_advance_minutes = ?,
          notification_methods = ?,
          email_reminder_enabled = ?,
          browser_reminder_enabled = ?,
          caldav_reminder_enabled = ?,
          quiet_start_time = ?,
          quiet_end_time = ?
        WHERE username = ?
      `, [
        reminders.eventReminderEnabled ? 1 : 0,
        reminders.todoReminderEnabled ? 1 : 0,
        reminders.reminderAdvanceDays || 0,
        reminders.reminderAdvanceHours || 0,
        reminders.reminderAdvanceMinutes || 30,
        reminders.notificationMethods || '["browser"]',
        reminders.emailReminderEnabled ? 1 : 0,
        reminders.browserReminderEnabled ? 1 : 0,
        reminders.caldavReminderEnabled ? 1 : 0,
        reminders.quietStartTime || null,
        reminders.quietEndTime || null,
        username
      ]);

      log('INFO', '导入提醒设置（更新）', { username });
    } else {
      // 插入新设置
      await db.run(`
        INSERT INTO reminder_settings (
          username, event_reminder_enabled, todo_reminder_enabled,
          reminder_advance_days, reminder_advance_hours, reminder_advance_minutes,
          notification_methods, email_reminder_enabled, browser_reminder_enabled,
          caldav_reminder_enabled, quiet_start_time, quiet_end_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        username,
        reminders.eventReminderEnabled ? 1 : 0,
        reminders.todoReminderEnabled ? 1 : 0,
        reminders.reminderAdvanceDays || 0,
        reminders.reminderAdvanceHours || 0,
        reminders.reminderAdvanceMinutes || 30,
        reminders.notificationMethods || '["browser"]',
        reminders.emailReminderEnabled ? 1 : 0,
        reminders.browserReminderEnabled ? 1 : 0,
        reminders.caldavReminderEnabled ? 1 : 0,
        reminders.quietStartTime || null,
        reminders.quietEndTime || null
      ]);

      log('INFO', '导入提醒设置（新增）', { username });
    }

    res.json({ success: true, message: '提醒设置导入成功' });
  } catch (e) {
    log('ERROR', '导入提醒设置失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '导入失败: ' + e.message });
  }
});

module.exports = router;
