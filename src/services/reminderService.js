/**
 * 提醒服务
 * 处理邮件提醒、浏览器通知和日历应用同步提醒
 */

const { getConnection } = require('../db/connection');
const { sendMail } = require('./mailer');
const { broadcast } = require('../routes/ws');
const log = require('../utils/logger');

let isChecking = false;

/**
 * 获取用户提醒设置
 */
async function getUserReminderSettings(username) {
  try {
    const db = getConnection();
    let settings = await db.get(
      'SELECT * FROM reminder_settings WHERE username = ?',
      [username]
    );

    // 如果没有设置，创建默认设置
    if (!settings) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      await db.run(
        `INSERT INTO reminder_settings (id, username) VALUES (?, ?)`,
        [id, username]
      );
      settings = await db.get(
        'SELECT * FROM reminder_settings WHERE username = ?',
        [username]
      );
    }

    return settings;
  } catch (e) {
    log('ERROR', '获取用户提醒设置失败', { username, error: e.message });
    return null;
  }
}

/**
 * 更新用户提醒设置
 */
async function updateUserReminderSettings(username, settings) {
  try {
    const db = getConnection();
    const existing = await getUserReminderSettings(username);

    if (!existing) {
      // 创建新设置
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      await db.run(
        `INSERT INTO reminder_settings (
          id, username, event_reminder_enabled, todo_reminder_enabled,
          reminder_advance_days, reminder_advance_hours, reminder_advance_minutes,
          notification_methods, email_reminder_enabled, browser_reminder_enabled,
          caldav_reminder_enabled, quiet_start_time, quiet_end_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          username,
          settings.event_reminder_enabled !== undefined ? settings.event_reminder_enabled : 1,
          settings.todo_reminder_enabled !== undefined ? settings.todo_reminder_enabled : 1,
          settings.reminder_advance_days !== undefined ? settings.reminder_advance_days : 1,
          settings.reminder_advance_hours !== undefined ? settings.reminder_advance_hours : 0,
          settings.reminder_advance_minutes !== undefined ? settings.reminder_advance_minutes : 0,
          settings.notification_methods || 'email,browser',
          settings.email_reminder_enabled !== undefined ? settings.email_reminder_enabled : 1,
          settings.browser_reminder_enabled !== undefined ? settings.browser_reminder_enabled : 1,
          settings.caldav_reminder_enabled !== undefined ? settings.caldav_reminder_enabled : 0,
          settings.quiet_start_time || '22:00',
          settings.quiet_end_time || '08:00'
        ]
      );
    } else {
      // 更新现有设置
      await db.run(
        `UPDATE reminder_settings SET
         event_reminder_enabled = COALESCE(?, event_reminder_enabled),
         todo_reminder_enabled = COALESCE(?, todo_reminder_enabled),
         reminder_advance_days = COALESCE(?, reminder_advance_days),
         reminder_advance_hours = COALESCE(?, reminder_advance_hours),
         reminder_advance_minutes = COALESCE(?, reminder_advance_minutes),
         notification_methods = COALESCE(?, notification_methods),
         email_reminder_enabled = COALESCE(?, email_reminder_enabled),
         browser_reminder_enabled = COALESCE(?, browser_reminder_enabled),
         caldav_reminder_enabled = COALESCE(?, caldav_reminder_enabled),
         quiet_start_time = COALESCE(?, quiet_start_time),
         quiet_end_time = COALESCE(?, quiet_end_time),
         updatedAt = ?
         WHERE username = ?`,
        [
          settings.event_reminder_enabled,
          settings.todo_reminder_enabled,
          settings.reminder_advance_days,
          settings.reminder_advance_hours,
          settings.reminder_advance_minutes,
          settings.notification_methods,
          settings.email_reminder_enabled,
          settings.browser_reminder_enabled,
          settings.caldav_reminder_enabled,
          settings.quiet_start_time,
          settings.quiet_end_time,
          Math.floor(Date.now() / 1000),
          username
        ]
      );
    }

    log('INFO', '更新用户提醒设置', { username });
    return await getUserReminderSettings(username);
  } catch (e) {
    log('ERROR', '更新用户提醒设置失败', { username, error: e.message });
    throw e;
  }
}

/**
 * 计算提醒时间
 */
function calculateReminderTime(startTime, settings) {
  const eventDate = new Date(startTime * 1000);
  const advanceDays = settings.reminder_advance_days !== undefined ? settings.reminder_advance_days : 1;
  const advanceHours = settings.reminder_advance_hours !== undefined ? settings.reminder_advance_hours : 0;
  const advanceMinutes = settings.reminder_advance_minutes !== undefined ? settings.reminder_advance_minutes : 0;

  const reminderDate = new Date(eventDate);
  reminderDate.setDate(reminderDate.getDate() - advanceDays);
  reminderDate.setHours(reminderDate.getHours() - advanceHours);
  reminderDate.setMinutes(reminderDate.getMinutes() - advanceMinutes);

  return Math.floor(reminderDate.getTime() / 1000);
}

/**
 * 检查是否在免打扰时间段
 */
function isQuietTime(settings) {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const quietStart = settings.quiet_start_time || '22:00';
  const quietEnd = settings.quiet_end_time || '08:00';

  if (quietStart === quietEnd) {
    return false;
  }

  if (quietStart < quietEnd) {
    return currentTime >= quietStart && currentTime < quietEnd;
  } else {
    return currentTime >= quietStart || currentTime < quietEnd;
  }
}

/**
 * 发送邮件提醒
 */
async function sendEmailReminder(username, type, item, settings) {
  try {
    const db = getConnection();
    const user = await db.get(
      'SELECT email FROM users WHERE username = ?',
      [username]
    );

    if (!user || !user.email) {
      throw new Error('用户未设置邮箱');
    }

    const isEvent = type === 'event';
    const title = item.title;
    const startTime = isEvent ? item.startTime : item.dueDate;
    const timeStr = new Date(startTime * 1000).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const subject = isEvent
      ? `[z7Note] 事件提醒: ${title}`
      : `[z7Note] 待办提醒: ${title}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
          .title { font-size: 20px; font-weight: bold; margin-bottom: 10px; }
          .time { color: #64748b; margin-bottom: 15px; }
          .description { color: #334155; line-height: 1.6; }
          .footer { margin-top: 20px; text-align: center; color: #94a3b8; font-size: 12px; }
          .button { display: inline-block; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>z7Note 提醒</h2>
          </div>
          <div class="content">
            <div class="title">${isEvent ? '📅 事件提醒' : '✅ 待办提醒'}</div>
            <div class="title">${title}</div>
            <div class="time">⏰ 时间: ${timeStr}</div>
            ${item.description ? `<div class="description">${item.description}</div>` : ''}
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/calendar.html" class="button">查看日历</a>
          </div>
          <div class="footer">
            此邮件由 z7Note 自动发送，请勿回复
          </div>
        </div>
      </body>
      </html>
    `;

    await sendMail({
      to: user.email,
      subject,
      html
    });

    log('INFO', '邮件提醒发送成功', { username, type, itemId: item.id });
    return true;
  } catch (e) {
    log('ERROR', '邮件提醒发送失败', { username, type, itemId: item.id, error: e.message });
    throw e;
  }
}

/**
 * 发送浏览器通知（通过WebSocket）
 */
async function sendBrowserReminder(username, type, item, settings) {
  try {
    const isEvent = type === 'event';
    const startTime = isEvent ? item.startTime : item.dueDate;
    const timeStr = new Date(startTime * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const notification = {
      type: 'reminder',
      itemType: type,
      item: {
        id: item.id,
        title: item.title,
        description: item.description,
        startTime: startTime,
        timeStr: timeStr
      }
    };

    broadcast('reminder', notification, { username });
    log('INFO', '浏览器提醒发送成功', { username, type, itemId: item.id });
    return true;
  } catch (e) {
    log('ERROR', '浏览器提醒发送失败', { username, type, itemId: item.id, error: e.message });
    return false;
  }
}

/**
 * 发送日历应用同步提醒（通过CalDAV VALARM）
 */
async function sendCaldavReminder(username, type, item, settings) {
  try {
    log('INFO', 'CalDAV提醒标记', { username, type, itemId: item.id });
    return true;
  } catch (e) {
    log('ERROR', 'CalDAV提醒标记失败', { username, type, itemId: item.id, error: e.message });
    return false;
  }
}

/**
 * 记录提醒历史
 */
async function recordReminderHistory(username, type, targetId, method, status, errorMessage = null) {
  try {
    const db = getConnection();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await db.run(
      `INSERT INTO reminder_history (id, username, type, target_id, reminder_time, method, status, error_message, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        username,
        type,
        targetId,
        Math.floor(Date.now() / 1000),
        method,
        status,
        errorMessage,
        status === 'sent' ? Math.floor(Date.now() / 1000) : null
      ]
    );
  } catch (e) {
    log('ERROR', '记录提醒历史失败', { username, error: e.message });
  }
}

/**
 * 发送提醒
 */
async function sendReminder(username, type, item, settings) {
  const methods = settings.notification_methods ? settings.notification_methods.split(',') : ['email', 'browser'];
  const results = [];

  for (const method of methods) {
    try {
      let success = false;
      const trimmedMethod = method.trim();

      if (trimmedMethod === 'email' && settings.email_reminder_enabled) {
        success = await sendEmailReminder(username, type, item, settings);
      } else if (trimmedMethod === 'browser' && settings.browser_reminder_enabled) {
        success = await sendBrowserReminder(username, type, item, settings);
      } else if (trimmedMethod === 'caldav' && settings.caldav_reminder_enabled) {
        success = await sendCaldavReminder(username, type, item, settings);
      } else {
        continue;
      }

      if (success) {
        await recordReminderHistory(username, type, item.id, trimmedMethod, 'sent');
        results.push({ method: trimmedMethod, status: 'success' });
      }
    } catch (e) {
      await recordReminderHistory(username, type, item.id, method.trim(), 'failed', e.message);
      results.push({ method: method.trim(), status: 'failed', error: e.message });
    }
  }

  return results;
}

/**
 * 检查并发送待处理的提醒
 */
async function checkAndSendPendingReminders() {
  if (isChecking) return;
  isChecking = true;

  try {
    const db = getConnection();
    if (!db) return;
    
    const now = Math.floor(Date.now() / 1000);

    // 获取所有启用了提醒的用户设置
    const usersSettings = await db.all(
      'SELECT * FROM reminder_settings WHERE event_reminder_enabled = 1 OR todo_reminder_enabled = 1'
    );

    for (const settings of usersSettings) {
      const username = settings.username;

      // 检查免打扰时间
      if (isQuietTime(settings)) continue;

      // 检查事件提醒
      if (settings.event_reminder_enabled) {
        const events = await db.all(
          `SELECT * FROM events
           WHERE username = ?
           AND startTime > ?
           AND (reminderEmail = 1 OR reminderBrowser = 1 OR reminderCaldav = 1)
           AND id NOT IN (
             SELECT target_id FROM reminder_history
             WHERE username = ? AND type = 'event' AND status = 'sent'
           )`,
          [username, now, username]
        );

        for (const event of events) {
          const reminderTime = calculateReminderTime(event.startTime, settings);
          // 只有在提醒时间点到事件开始前的窗口内才发送
          if (reminderTime <= now && event.startTime > now) {
            await sendReminder(username, 'event', event, settings);
          }
        }
      }

      // 检查待办提醒
      if (settings.todo_reminder_enabled) {
        const todos = await db.all(
          `SELECT * FROM todos
           WHERE username = ?
           AND dueDate > ?
           AND completed = 0
           AND (reminderEmail = 1 OR reminderBrowser = 1)
           AND id NOT IN (
             SELECT target_id FROM reminder_history
             WHERE username = ? AND type = 'todo' AND status = 'sent'
           )`,
          [username, now, username]
        );

        for (const todo of todos) {
          const reminderTime = calculateReminderTime(todo.dueDate, settings);
          if (reminderTime <= now && todo.dueDate > now) {
            await sendReminder(username, 'todo', todo, settings);
          }
        }
      }
    }
  } catch (e) {
    log('ERROR', '检查并发送提醒失败', { error: e.message });
  } finally {
    isChecking = false;
  }
}

module.exports = {
  getUserReminderSettings,
  updateUserReminderSettings,
  calculateReminderTime,
  isQuietTime,
  sendReminder,
  checkAndSendPendingReminders
};
