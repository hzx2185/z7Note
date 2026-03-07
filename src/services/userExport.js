const fs = require('fs').promises;
const path = require('path');
const { getConnection } = require('../db/connection');
const config = require('../config');
const { sendMail } = require('./mailer');
const log = require('../utils/logger');
const { exportToICS } = require('../utils/icsExport');
const VCardGenerator = require('../utils/vCardGenerator');
const WebDAVHelper = require('../utils/webdavHelper');
const { toClientCalendarId } = require('../utils/calendarIds');

// 用户定时备份任务管理
const userBackupTasks = new Map();

/**
 * 导出用户文本数据（JSON/ICS/VCF）
 */
async function exportUserData(username, backupConfig) {
  const db = getConnection();
  const textFiles = [];

  try {
    // 1. 导出笔记数据
    const notes = await db.all(
      'SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND deleted = 0',
      [username]
    );
    const notesData = {
      username,
      exportTime: new Date().toISOString(),
      notes: notes.map(note => ({
        id: note.id,
        title: note.title,
        content: note.content,
        updatedAt: new Date(note.updatedAt * 1000).toISOString()
      }))
    };
    textFiles.push({ filename: `${username}-notes.json`, buffer: Buffer.from(JSON.stringify(notesData, null, 2), 'utf-8') });

    // 2. 导出日历事件
    if (backupConfig.includeCalendar) {
      const events = await db.all('SELECT * FROM events WHERE username = ?', [username]);
      if (events.length > 0) {
        const exportedEvents = events.map(event => ({ ...event, id: toClientCalendarId(username, event.id) }));
        const icsContent = exportToICS(exportedEvents, { targetApp: 'standard', includeReminders: true });
        textFiles.push({ filename: `${username}-calendar.ics`, buffer: Buffer.from(icsContent, 'utf-8') });
      }
    }

    // 3. 导出待办事项
    if (backupConfig.includeTodos) {
      const todos = await db.all('SELECT id, title, description, completed, priority, dueDate, noteId, updatedAt FROM todos WHERE username = ?', [username]);
      const todosData = { username, exportTime: new Date().toISOString(), todos: todos.map(todo => ({
        id: toClientCalendarId(username, todo.id), title: todo.title, description: todo.description, completed: todo.completed === 1,
        priority: todo.priority, dueDate: todo.dueDate ? new Date(todo.dueDate * 1000).toISOString() : null,
        noteId: todo.noteId, updatedAt: new Date(todo.updatedAt * 1000).toISOString()
      }))};
      textFiles.push({ filename: `${username}-todos.json`, buffer: Buffer.from(JSON.stringify(todosData, null, 2), 'utf-8') });
    }

    // 4. 导出联系人
    if (backupConfig.includeContacts) {
      const contacts = await db.all('SELECT * FROM contacts WHERE username = ?', [username]);
      if (contacts.length > 0) {
        const vcards = contacts.map(c => VCardGenerator.contactToVCard(c)).join('\r\n');
        textFiles.push({ filename: `${username}-contacts.vcf`, buffer: Buffer.from(vcards, 'utf-8') });
      }
    }

    // 5. 导出提醒设置
    if (backupConfig.includeReminders) {
      const rs = await db.get('SELECT * FROM reminder_settings WHERE username = ?', [username]);
      if (rs) {
        const remindersData = { username, exportTime: new Date().toISOString(), reminders: {
          eventReminderEnabled: rs.event_reminder_enabled === 1, todoReminderEnabled: rs.todo_reminder_enabled === 1,
          reminderAdvanceDays: rs.reminder_advance_days, reminderAdvanceHours: rs.reminder_advance_hours,
          reminderAdvanceMinutes: rs.reminder_advance_minutes, notificationMethods: rs.notification_methods,
          emailReminderEnabled: rs.email_reminder_enabled === 1, browserReminderEnabled: rs.browser_reminder_enabled === 1,
          caldavReminderEnabled: rs.caldav_reminder_enabled === 1, quietStartTime: rs.quiet_start_time, quietEndTime: rs.quiet_end_time
        }};
        textFiles.push({ filename: `${username}-reminders.json`, buffer: Buffer.from(JSON.stringify(remindersData, null, 2), 'utf-8') });
      }
    }

    return { textFiles, notesCount: notes.length };
  } catch (e) {
    console.error(`[用户导出] ${username} 文本导出失败:`, e);
    throw e;
  }
}

/**
 * 核心备份流程：发送数据到 WebDAV
 */
async function performUserBackup(username, backupConfig) {
  const startTime = Date.now();
  const nodeFs = require('fs');
  console.log(`[用户备份] ${username} 开始备份流程...`);

  try {
    // 1. 获取文本数据 (JSON/ICS/VCF)
    const { textFiles } = await exportUserData(username, backupConfig);

    // 2. 连接 WebDAV
    const client = WebDAVHelper.getClient(backupConfig.webdavUrl, backupConfig.webdavUsername, backupConfig.webdavPassword);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folderPath = `/z7note-backups/${username}/${timestamp}/`;

    // 确保目录存在
    await WebDAVHelper.ensureDirectory(client, folderPath);

    // 3. 上传文本文件
    let totalFiles = 0;
    for (const file of textFiles) {
      await WebDAVHelper.uploadFile(client, folderPath + file.filename, file.buffer);
      totalFiles++;
    }

    // 4. 上传附件
    let attachmentCount = 0;
    if (backupConfig.includeAttachments) {
      try {
        const userUploadDir = path.join(config.paths.uploads, username);
        const files = await fs.readdir(userUploadDir);
        for (const filename of files) {
          const filePath = path.join(userUploadDir, filename);
          const stats = await fs.stat(filePath);
          if (stats.isFile()) {
            const fileStream = nodeFs.createReadStream(filePath);
            await WebDAVHelper.uploadFile(client, folderPath + filename, fileStream);
            attachmentCount++;
            totalFiles++;
            await new Promise(r => setTimeout(r, 50));
          }
        }
      } catch (e) { /* 无附件 */ }
    }

    // 5. 邮件通知
    if (backupConfig.sendEmail && backupConfig.emailAddress) {
      try {
        const fileSummary = textFiles.map(f => `  - ${f.filename}`).join('\n') + (attachmentCount > 0 ? `\n  - ${attachmentCount} 个附件文件` : '');
        await sendMail({
          to: backupConfig.emailAddress,
          subject: `[z7Note 备份] 数据已自动备份至 WebDAV`,
          text: `您的数据已成功备份至云端 WebDAV。\n\n备份路径: ${folderPath}\n总文件数: ${totalFiles} 个\n\n数据清单:\n${fileSummary}\n\n备份时间: ${new Date().toLocaleString('zh-CN')}\n\n如有问题请联系管理员。`
        });
      } catch (e) { console.error(`[用户备份] ${username} 邮件发送失败:`, e.message); }
    }

    // 6. 更新最后备份时间
    await updateUserBackupTime(username);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[用户备份] ${username} 全部完成，总耗时: ${duration}秒`);
    log('INFO', '用户备份成功', { username, path: folderPath, fileCount: totalFiles, duration: `${duration}s` });

    return { success: true, path: folderPath, fileCount: totalFiles };
  } catch (e) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[用户备份] ${username} 备份失败:`, e.message);
    log('ERROR', '用户备份失败', { username, error: e.message, duration: `${duration}s` });
    throw e;
  }
}

/**
 * 获取用户备份配置
 */
async function getUserBackupConfig(username) {
  const db = getConnection();
  const config = await db.get('SELECT * FROM user_backup_config WHERE username = ?', [username]);

  if (!config) {
    return {
      username,
      enabled: 0,
      schedule: '0 20 * * *',
      sendEmail: 1,
      emailAddress: null,
      webdavUrl: null,
      webdavUsername: null,
      webdavPassword: null,
      includeAttachments: 1,
      includeCalendar: 1,
      includeTodos: 1,
      includeContacts: 1,
      includeReminders: 1,
      lastBackupTime: 0
    };
  }

  return {
    username: config.username,
    enabled: config.enabled === 1,
    schedule: config.schedule,
    sendEmail: config.sendEmail === 1,
    emailAddress: config.emailAddress,
    webdavUrl: config.webdavUrl,
    webdavUsername: config.webdavUsername,
    webdavPassword: config.webdavPassword,
    includeAttachments: config.includeAttachments === 1,
    includeCalendar: config.includeCalendar !== undefined ? config.includeCalendar === 1 : 1,
    includeTodos: config.includeTodos !== undefined ? config.includeTodos === 1 : 1,
    includeContacts: config.includeContacts !== undefined ? config.includeContacts === 1 : 1,
    includeReminders: config.includeReminders !== undefined ? config.includeReminders === 1 : 1,
    lastBackupTime: config.lastBackupTime > 10000000000 ? config.lastBackupTime : (config.lastBackupTime || 0) * 1000
  };
}

/**
 * 更新用户备份配置
 */
async function updateUserBackupConfig(username, configData) {
  const db = getConnection();

  await db.run(`
    INSERT INTO user_backup_config (username, enabled, schedule, sendEmail, emailAddress, webdavUrl, webdavUsername, webdavPassword, includeAttachments, includeCalendar, includeTodos, includeContacts, includeReminders, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      enabled=excluded.enabled,
      schedule=excluded.schedule,
      sendEmail=excluded.sendEmail,
      emailAddress=excluded.emailAddress,
      webdavUrl=excluded.webdavUrl,
      webdavUsername=excluded.webdavUsername,
      webdavPassword=excluded.webdavPassword,
      includeAttachments=excluded.includeAttachments,
      includeCalendar=excluded.includeCalendar,
      includeTodos=excluded.includeTodos,
      includeContacts=excluded.includeContacts,
      includeReminders=excluded.includeReminders,
      updatedAt=excluded.updatedAt
  `, [
    username,
    configData.enabled ? 1 : 0,
    configData.schedule,
    configData.sendEmail ? 1 : 0,
    configData.emailAddress,
    configData.webdavUrl,
    configData.webdavUsername,
    configData.webdavPassword,
    configData.includeAttachments ? 1 : 0,
    configData.includeCalendar !== undefined ? (configData.includeCalendar ? 1 : 0) : 1,
    configData.includeTodos !== undefined ? (configData.includeTodos ? 1 : 0) : 1,
    configData.includeContacts !== undefined ? (configData.includeContacts ? 1 : 0) : 1,
    configData.includeReminders !== undefined ? (configData.includeReminders ? 1 : 0) : 1,
    Math.floor(Date.now() / 1000)
  ]);

  log('INFO', '用户备份配置已更新', { username, enabled: configData.enabled });
}

/**
 * 设置用户备份定时任务
 */
function setupUserBackupCron(username, backupConfig) {
  const cron = require('node-cron');

  // 停止旧任务
  if (userBackupTasks.has(username)) {
    const oldTask = userBackupTasks.get(username);
    try {
      if (oldTask && typeof oldTask.stop === 'function') {
        oldTask.stop();
      }
    } catch (e) {
      console.error(`[用户备份] 停止旧任务失败 ${username}:`, e);
    }
    userBackupTasks.delete(username);
  }

  // 如果未启用，不设置任务
  if (!backupConfig.enabled || !backupConfig.schedule || backupConfig.schedule === 'none') {
    return;
  }

  // 创建新任务
  try {
    const task = cron.schedule(backupConfig.schedule, async () => {
      try {
        await performUserBackup(username, backupConfig);
      } catch (e) {
        log('ERROR', '用户备份任务执行失败', { username, error: e.message });
      }
    }, { scheduled: true, timezone: 'Asia/Shanghai' });

    userBackupTasks.set(username, task);
    log('INFO', '用户备份任务已设置', { username, schedule: backupConfig.schedule });
  } catch (e) {
    log('ERROR', '用户备份任务创建失败', { username, error: e.message });
  }
}

/**
 * 更新用户最后备份时间
 */
async function updateUserBackupTime(username) {
  const db = getConnection();
  await db.run(
    'UPDATE user_backup_config SET lastBackupTime = ?, updatedAt = ? WHERE username = ?',
    [Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), username]
  );
}

module.exports = {
  exportUserData,
  performUserBackup,
  setupUserBackupCron,
  getUserBackupConfig,
  updateUserBackupConfig,
  updateUserBackupTime
};
