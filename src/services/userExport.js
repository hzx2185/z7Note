const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('webdav');
const { getConnection } = require('../db/connection');
const config = require('../config');
const { sendMail } = require('./mailer');
const log = require('../utils/logger');

// 用户定时备份任务管理
const userBackupTasks = new Map();

/**
 * 导出用户数据
 */
async function exportUserData(username, includeAttachments = true) {
  const db = getConnection();
  
  try {
    // 1. 导出笔记数据为 JSON
    const notes = await db.all(
      'SELECT id, title, content, updatedAt FROM notes WHERE username = ? AND deleted = 0',
      [username]
    );

    const jsonData = {
      username,
      exportTime: new Date().toISOString(),
      notes: notes.map(note => ({
        id: note.id,
        title: note.title,
        content: note.content,
        updatedAt: new Date(note.updatedAt * 1000).toISOString()
      }))
    };
    
    const jsonBuffer = Buffer.from(JSON.stringify(jsonData, null, 2), 'utf-8');
    
    // 2. 收集附件文件
    let attachmentFiles = [];
    
    if (includeAttachments) {
      try {
        const userUploadDir = path.join(config.paths.uploads, username);
        const files = await fs.readdir(userUploadDir);
        
        attachmentFiles = await Promise.all(files.map(async filename => {
          const filePath = path.join(userUploadDir, filename);
          const stats = await fs.stat(filePath);
          
          if (stats.isFile()) {
            return {
              filename,
              buffer: await fs.readFile(filePath),
              size: stats.size
            };
          }
        })).then(files => files.filter(f => f));
      } catch (e) {
        console.log(`[用户导出] ${username} 没有附件或目录不存在`);
      }
    }
    
    return {
      json: { filename: `${username}-notes.json`, buffer: jsonBuffer, size: jsonBuffer.length },
      attachments: attachmentFiles
    };
  } catch (e) {
    console.error(`[用户导出] ${username} 导出失败:`, e);
    throw e;
  }
}

/**
 * 发送数据到 WebDAV
 */
async function sendToWebDAV(username, webdavConfig, exportData) {
  try {
    console.log(`[用户备份] ${username} 连接 WebDAV: ${webdavConfig.url}`);

    const client = createClient(webdavConfig.url, {
      username: webdavConfig.username,
      password: webdavConfig.password
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folderPath = `/z7note-backups/${username}/${timestamp}/`;


    // 创建备份目录（忽略已存在的错误）
    try {
      // 先尝试创建用户目录
      const userDir = `/z7note-backups/${username}/`;
      try {
        await client.createDirectory(userDir);
      } catch (e) {
        // 忽略 405（不支持创建目录）、409（已存在）等错误
        if (e.message && (e.message.includes('405') || e.message.includes('409'))) {
        } else {
          console.error(`[用户备份] ${username} 用户目录创建失败:`, e.message);
          throw e;
        }
      }

      // 再尝试创建时间戳目录
      try {
        await client.createDirectory(folderPath);
      } catch (e) {
        // 忽略 405（不支持创建目录）、409（已存在）等错误
        if (e.message && (e.message.includes('405') || e.message.includes('409'))) {
        } else {
          console.error(`[用户备份] ${username} 目录创建失败:`, e.message);
          throw e;
        }
      }
    } catch (e) {
      console.error(`[用户备份] ${username} 创建目录失败:`, e.message);
      throw e;
    }

    // 上传 JSON 文件
    try {
      await client.putFileContents(
        folderPath + exportData.json.filename,
        exportData.json.buffer
      );
    } catch (e) {
      console.error(`[用户备份] ${username} JSON 上传失败:`, e.message);
      throw e;
    }

    // 上传附件
    for (const attachment of exportData.attachments) {
      try {
        await client.putFileContents(
          folderPath + attachment.filename,
          attachment.buffer
        );
      } catch (e) {
        console.error(`[用户备份] ${username} 附件上传失败 (${attachment.filename}):`, e.message);
        throw e;
      }
    }

    log('INFO', '用户备份成功', { username, path: folderPath, fileCount: exportData.attachments.length + 1 });

    return { success: true, path: folderPath, fileCount: exportData.attachments.length + 1 };
  } catch (e) {
    console.error(`[用户备份] ${username} WebDAV 发送失败:`, e);
    log('ERROR', '用户备份失败', { username, error: e.message });
    throw e;
  }
}

/**
 * 执行用户备份
 */
async function performUserBackup(username, backupConfig) {
  const startTime = Date.now();
  console.log(`[用户备份] ${username} 开始备份`);
  log('INFO', '用户备份开始', { username, includeAttachments: backupConfig.includeAttachments });

  try {
    // 1. 导出用户数据
    const exportData = await exportUserData(username, backupConfig.includeAttachments);
    console.log(`[用户备份] ${username} 导出完成，笔记数: ${exportData.attachments.length + 1}`);

    // 2. 发送到 WebDAV
    const result = await sendToWebDAV(username, {
      url: backupConfig.webdavUrl,
      username: backupConfig.webdavUsername,
      password: backupConfig.webdavPassword
    }, exportData);

    // 3. 发送邮件通知
    if (backupConfig.sendEmail && backupConfig.emailAddress) {
      try {
        await sendMail({
          to: backupConfig.emailAddress,
          subject: `[z7Note 备份] 数据已备份到 WebDAV`,
          text: `您的笔记数据已成功备份到 WebDAV\n\n备份路径: ${result.path}\n文件数量: ${result.fileCount} 个文件\n笔记数量: ${exportData.attachments.length + 1} 个文件\n备份时间: ${new Date().toLocaleString('zh-CN')}\n\n如有问题，请联系管理员。`
        });
        console.log(`[用户备份] ${username} 邮件通知已发送`);
      } catch (e) {
        console.error(`[用户备份] ${username} 邮件发送失败:`, e);
        // 邮件发送失败不影响备份成功状态
        log('WARN', '备份成功但邮件发送失败', { username, error: e.message });
      }
    }

    // 4. 更新最后备份时间
    await updateUserBackupTime(username);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[用户备份] ${username} 备份完成，耗时: ${duration}秒`);
    log('INFO', '用户备份成功', {
      username,
      path: result.path,
      fileCount: result.fileCount,
      duration: `${duration}s`
    });

    return { success: true, ...result };
  } catch (e) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[用户备份] ${username} 失败，耗时: ${duration}秒:`, e);
    log('ERROR', '用户备份失败', { username, error: e.message, duration: `${duration}s` });
    throw e;
  }
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
    console.log(`[用户备份] ${username} 旧任务已停止`);
  }

  // 如果未启用，不设置任务
  if (!backupConfig.enabled || !backupConfig.schedule || backupConfig.schedule === 'none') {
    console.log(`[用户备份] ${username} 定时任务未设置或已关闭`);
    log('INFO', '用户备份任务未设置', { username, enabled: backupConfig.enabled });
    return;
  }

  // 验证 cron 表达式格式
  try {
    if (!cron.validate(backupConfig.schedule)) {
      console.error(`[用户备份] ${username} 无效的 cron 表达式: ${backupConfig.schedule}`);
      log('ERROR', '用户备份 cron 表达式无效', { username, schedule: backupConfig.schedule });
      return;
    }
  } catch (e) {
    console.error(`[用户备份] ${username} 验证 cron 表达式失败:`, e);
    return;
  }

  // 创建新任务
  try {
    const task = cron.schedule(backupConfig.schedule, async () => {
      console.log(`[用户备份] ${username} 定时任务触发`);
      try {
        await performUserBackup(username, backupConfig);
      } catch (e) {
        console.error(`[用户备份] ${username} 定时任务执行失败:`, e);
        log('ERROR', '用户备份任务执行失败', { username, error: e.message });
      }
    }, { scheduled: true, timezone: 'Asia/Shanghai' });

    userBackupTasks.set(username, task);
    console.log(`[用户备份] ${username} 定时任务已设置: ${backupConfig.schedule}`);
    log('INFO', '用户备份任务已设置', { username, schedule: backupConfig.schedule });
  } catch (e) {
    console.error(`[用户备份] ${username} 创建定时任务失败:`, e);
    log('ERROR', '用户备份任务创建失败', { username, error: e.message });
  }
}

/**
 * 获取用户备份配置
 */
async function getUserBackupConfig(username) {
  const db = getConnection();
  const config = await db.get('SELECT * FROM user_backup_config WHERE username = ?', [username]);

  if (!config) {
    // 返回默认配置
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
    lastBackupTime: config.lastBackupTime
  };
}

/**
 * 更新用户备份配置
 */
async function updateUserBackupConfig(username, configData) {
  const db = getConnection();
  
  await db.run(`
    INSERT INTO user_backup_config (username, enabled, schedule, sendEmail, emailAddress, webdavUrl, webdavUsername, webdavPassword, includeAttachments, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      enabled=excluded.enabled,
      schedule=excluded.schedule,
      sendEmail=excluded.sendEmail,
      emailAddress=excluded.emailAddress,
      webdavUrl=excluded.webdavUrl,
      webdavUsername=excluded.webdavUsername,
      webdavPassword=excluded.webdavPassword,
      includeAttachments=excluded.includeAttachments,
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
    Date.now()
  ]);
  
  log('INFO', '用户备份配置已更新', { username, enabled: configData.enabled });
}

/**
 * 更新用户最后备份时间
 */
async function updateUserBackupTime(username) {
  const db = getConnection();
  await db.run(
    'UPDATE user_backup_config SET lastBackupTime = ?, updatedAt = ? WHERE username = ?',
    [Date.now(), Date.now(), username]
  );
}

module.exports = {
  exportUserData,
  sendToWebDAV,
  performUserBackup,
  setupUserBackupCron,
  getUserBackupConfig,
  updateUserBackupConfig,
  updateUserBackupTime
};
