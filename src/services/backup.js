const archiver = require('archiver');
const cron = require('node-cron');
const { createClient } = require('webdav');
const path = require('path');
const fs = require('fs').promises;
const nodeFs = require('fs');
const { sendMail } = require('./mailer');
const { getConnection } = require('../db/connection');
const config = require('../config');
const log = require('../utils/logger');

let scheduledTask = null;

async function createBackupArchive(incremental = true, includeAttachments = false) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = incremental ? `z7note-inc-${timestamp}.zip` : `z7note-backup-${timestamp}.zip`;
  const filePath = path.join(config.paths.backups, fileName);
  const output = nodeFs.createWriteStream(filePath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  // 获取最后一次备份时间（全量或增量）
  let lastBackupTime = 0;
  try {
    const files = await fs.readdir(config.paths.backups);
    const backupFiles = await Promise.all(
      files.map(async f => ({ name: f, stat: await fs.stat(path.join(config.paths.backups, f)) }))
    );
    if (backupFiles.length > 0) {
      lastBackupTime = Math.max(...backupFiles.map(f => f.stat.mtimeMs));
    }
  } catch (e) {
    // 备份目录不存在或读取失败，使用全量备份
  }

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve({ fileName, filePath, size: archive.pointer() }));
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(path.join(config.paths.data, 'z7note.db'), { name: 'z7note.db' });

    const walkAndAppend = async (dir, zipPath) => {
      try {
        const list = await fs.readdir(dir);
        await Promise.all(list.map(async (item) => {
          const itemPath = path.join(dir, item);
          const itemZipPath = path.join(zipPath, item);
          const stat = await fs.stat(itemPath);
          if (stat.isDirectory()) {
            await walkAndAppend(itemPath, itemZipPath);
          } else if (!incremental || stat.mtimeMs > lastBackupTime) {
            // 增量备份：只备份自上次备份后修改的文件
            // 全量备份：包含所有文件
            archive.file(itemPath, { name: itemZipPath });
          }
        }));
      } catch (err) {
        // 目录遍历失败，跳过
      }
    };

    // 始终包含附件目录（includeAttachments 控制是否打包附件）
    if (includeAttachments) {
      walkAndAppend(config.paths.uploads, 'uploads').then(() => archive.finalize()).catch(reject);
    } else {
      archive.finalize();
    }
  });
}

async function performBackup(backupConfig) {
  try {
    const isIncremental = backupConfig.backupMode !== 'full';
    const includeAttachments = !!backupConfig.includeAttachments;
    const { fileName, filePath, size } = await createBackupArchive(isIncremental, includeAttachments);
    console.log(`[备份] 创建备份文件: ${fileName}, 大小: ${(size / 1024).toFixed(2)} KB`);

    // 发送邮件（不发送附件，避免超时）
    if (backupConfig.sendEmail && backupConfig.emailAddress) {
      try {
        let emailText = `备份模式: ${isIncremental?'增量':'全量'}
附件: ${includeAttachments?'包含':'不包含'}
文件名: ${fileName}
文件大小: ${(size / 1024 / 1024).toFixed(2)} MB
备份时间: ${new Date().toLocaleString('zh-CN')}`;

        if (backupConfig.useWebDAV && backupConfig.webdavUrl) {
          emailText += `\n\n备份已上传到 WebDAV`;
        }

        await sendMail({
          to: backupConfig.emailAddress,
          subject: `[${isIncremental?'增量':'全量'}备份完成] ${fileName}`,
          text: emailText
        });
        console.log('[备份] 邮件发送成功');
      } catch (e) {
        console.error('[备份] 邮件发送失败:', e.message);
      }
    }

    // 上传到 WebDAV
    if (backupConfig.useWebDAV && backupConfig.webdavUrl) {
      try {
        const client = createClient(backupConfig.webdavUrl, {
          username: backupConfig.webdavUser,
          password: backupConfig.webdavPassword
        });
        
        // 使用流式上传，避免大文件内存溢出
        const fileStream = nodeFs.createReadStream(filePath);
        await client.putFileContents(`/${fileName}`, fileStream);
        console.log('[备份] WebDAV 流式上传成功');

        // 清理 WebDAV 上的旧备份
        if (backupConfig.keepCount && backupConfig.keepCount > 0) {
          // 稍微延迟执行清理，确保上传已完全同步
          setTimeout(() => cleanupOldBackups(client, backupConfig.keepCount, true), 5000);
        }
      } catch (e) {
        console.error('[备份] WebDAV 上传失败:', e.message);
      }
    }

    // 清理本地旧备份
    if (backupConfig.keepCount && backupConfig.keepCount > 0) {
      await cleanupOldBackups(null, backupConfig.keepCount, false);
    }

    log('INFO', '定时备份成功', { fileName, size });
  } catch (e) {
    console.error('定时备份失败:', e);
    log('ERROR', '定时备份失败', { error: e.message });
  }
}

/**
 * 清理旧备份
 * @param {Object} webdavClient - WebDAV 客户端，如果为 null 则清理本地备份
 * @param {number} keepCount - 保留的备份数量
 * @param {boolean} isWebDAV - 是否清理 WebDAV
 */
async function cleanupOldBackups(webdavClient, keepCount, isWebDAV) {
  try {
    let files = [];

    if (isWebDAV && webdavClient) {
      // 获取 WebDAV 文件列表
      const items = await webdavClient.getDirectoryContents('/');
      files = items
        .filter(item => item.type === 'file' && (item.basename.startsWith('z7note-inc-') || item.basename.startsWith('z7note-backup-')))
        .map(item => ({
          name: item.basename,
          time: item.lastmod || new Date(item.timestamp)
        }));
    } else {
      // 获取本地备份文件列表
      const localFiles = await fs.readdir(config.paths.backups);
      files = await Promise.all(localFiles
        .filter(f => f.startsWith('z7note-inc-') || f.startsWith('z7note-backup-'))
        .map(async f => ({
          name: f,
          time: (await fs.stat(path.join(config.paths.backups, f))).mtime
        })));
    }

    // 按时间倒序排序
    files.sort((a, b) => b.time - a.time);

    // 删除超出保留数量的备份
    if (files.length > keepCount) {
      const filesToDelete = files.slice(keepCount);

      for (const file of filesToDelete) {
        try {
          if (isWebDAV && webdavClient) {
            await webdavClient.deleteFile(`/${file.name}`);
            console.log(`[备份清理] 删除 WebDAV 备份: ${file.name}`);
          } else {
            await fs.unlink(path.join(config.paths.backups, file.name));
            console.log(`[备份清理] 删除本地备份: ${file.name}`);
          }
        } catch (e) {
          console.error(`[备份清理] 删除失败 ${file.name}:`, e.message);
        }
      }

      log('INFO', '清理旧备份', { count: filesToDelete.length, kept: keepCount });
    }
  } catch (e) {
    console.error('[备份清理] 失败:', e.message);
  }
}

function setupCron(configObj) {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  if (configObj.schedule && configObj.schedule !== 'none') {
    console.log('[备份] 正在设置定时任务，cron 表达式:', configObj.schedule);
    scheduledTask = cron.schedule(configObj.schedule, async () => {
      console.log('[备份] 定时任务触发，开始执行备份...');
      await performBackup(configObj);
    }, { scheduled: true, timezone: 'Asia/Shanghai' });
    console.log('[备份] 定时任务已启动');
    log('INFO', '定时备份任务已设置', { schedule: configObj.schedule });
  } else {
    console.log('[备份] 定时任务未设置或已关闭');
  }
}

async function getBackupConfig() {
  const db = getConnection();
  return await db.get('SELECT * FROM backup_config WHERE id = 1');
}

async function updateBackupConfig(configData) {
  const db = getConnection();
  await db.run(`INSERT INTO backup_config (id, schedule, includeAttachments, backupMode, sendEmail, emailAddress, useWebDAV, webdavUrl, webdavUser, webdavPassword)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET 
    schedule=excluded.schedule, includeAttachments=excluded.includeAttachments, backupMode=excluded.backupMode,
    sendEmail=excluded.sendEmail, emailAddress=excluded.emailAddress, useWebDAV=excluded.useWebDAV, 
    webdavUrl=excluded.webdavUrl, webdavUser=excluded.webdavUser, webdavPassword=excluded.webdavPassword`, 
    [configData.schedule, configData.includeAttachments?1:0, configData.backupMode, 
     configData.sendEmail?1:0, configData.emailAddress, configData.useWebDAV?1:0, 
     configData.webdavUrl, configData.webdavUser, configData.webdavPassword, '']);
  
  const newConfig = await getBackupConfig();
  setupCron(newConfig);
}

async function getBackupList() {
  const files = await fs.readdir(config.paths.backups);
  const list = await Promise.all(files.map(async f => ({ 
    name: f, 
    size: (await fs.stat(path.join(config.paths.backups, f))).size, 
    time: (await fs.stat(path.join(config.paths.backups, f))).mtime 
  })));
  return list.sort((a, b) => b.time - a.time);
}

module.exports = {
  createBackupArchive,
  performBackup,
  setupCron,
  getBackupConfig,
  updateBackupConfig,
  getBackupList,
  cleanupOldBackups
};
