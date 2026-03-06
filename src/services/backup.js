const archiver = require('archiver');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs').promises;
const nodeFs = require('fs');
const { sendMail } = require('./mailer');
const { getConnection } = require('../db/connection');
const config = require('../config');
const log = require('../utils/logger');
const WebDAVHelper = require('../utils/webdavHelper');

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
    const includeAttachments = backupConfig.includeAttachments === true || backupConfig.includeAttachments === 1 || backupConfig.includeAttachments === 'true' || backupConfig.includeAttachments === '1';
    const sendEmail = backupConfig.sendEmail === true || backupConfig.sendEmail === 1 || backupConfig.sendEmail === 'true' || backupConfig.sendEmail === '1';
    const useWebDAV = backupConfig.useWebDAV === true || backupConfig.useWebDAV === 1 || backupConfig.useWebDAV === 'true' || backupConfig.useWebDAV === '1';

    const { fileName, filePath, size } = await createBackupArchive(isIncremental, includeAttachments);
    console.log(`[备份] 创建备份文件: ${fileName}, 大小: ${(size / 1024).toFixed(2)} KB`);

    // 发送邮件（不发送附件，避免超时）
    if (sendEmail && backupConfig.emailAddress) {
      try {
        let emailText = `备份模式: ${isIncremental?'增量':'全量'}
附件: ${includeAttachments?'包含':'不包含'}
文件名: ${fileName}
文件大小: ${(size / 1024 / 1024).toFixed(2)} MB
备份时间: ${new Date().toLocaleString('zh-CN')}`;

        if (useWebDAV && backupConfig.webdavUrl) {
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
    if (useWebDAV && backupConfig.webdavUrl) {
      try {
        const client = WebDAVHelper.getClient(backupConfig.webdavUrl, backupConfig.webdavUser, backupConfig.webdavPassword);
        
        // 使用流式上传，避免大文件内存溢出
        const fileStream = nodeFs.createReadStream(filePath);
        await WebDAVHelper.uploadFile(client, `/${fileName}`, fileStream);
        console.log('[备份] WebDAV 上传成功');

        // 清理 WebDAV 上的旧备份
        if (backupConfig.keepCount && backupConfig.keepCount > 0) {
          setTimeout(() => {
            WebDAVHelper.cleanupOldFiles(client, '/', 'z7note-', backupConfig.keepCount)
              .catch(err => console.error('[备份清理] WebDAV 清理失败:', err.message));
          }, 5000);
        }
      } catch (e) {
        console.error('[备份] WebDAV 上传失败:', e.message);
      }
    }

    // 清理本地旧备份
    if (backupConfig.keepCount && backupConfig.keepCount > 0) {
      await cleanupOldLocalBackups(backupConfig.keepCount);
    }

    log('INFO', '定时备份成功', { fileName, size });
  } catch (e) {
    console.error('定时备份失败:', e);
    log('ERROR', '定时备份失败', { error: e.message });
  }
}

/**
 * 清理本地旧备份
 */
async function cleanupOldLocalBackups(keepCount) {
  try {
    const localFiles = await fs.readdir(config.paths.backups);
    const files = await Promise.all(localFiles
      .filter(f => f.startsWith('z7note-inc-') || f.startsWith('z7note-backup-'))
      .map(async f => ({
        name: f,
        time: (await fs.stat(path.join(config.paths.backups, f))).mtime
      })));

    // 按时间倒序排序
    files.sort((a, b) => b.time - a.time);

    // 删除超出保留数量的备份
    if (files.length > keepCount) {
      const filesToDelete = files.slice(keepCount);
      for (const file of filesToDelete) {
        try {
          await fs.unlink(path.join(config.paths.backups, file.name));
          console.log(`[备份清理] 删除本地备份: ${file.name}`);
        } catch (e) {
          console.error(`[备份清理] 删除失败 ${file.name}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[备份清理] 本地清理失败:', e.message);
  }
}

function setupCron(configObj) {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  if (configObj && configObj.schedule && configObj.schedule !== 'none') {
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
  const config = await db.get('SELECT * FROM backup_config WHERE id = 1');
  return config || {};
}

async function updateBackupConfig(configData) {
  const db = getConnection();
  await db.run(`INSERT INTO backup_config (id, schedule, includeAttachments, backupMode, sendEmail, emailAddress, useWebDAV, webdavUrl, webdavUser, webdavPassword, keepCount)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET 
    schedule=excluded.schedule, includeAttachments=excluded.includeAttachments, backupMode=excluded.backupMode,
    sendEmail=excluded.sendEmail, emailAddress=excluded.emailAddress, useWebDAV=excluded.useWebDAV, 
    webdavUrl=excluded.webdavUrl, webdavUser=excluded.webdavUser, webdavPassword=excluded.webdavPassword,
    keepCount=excluded.keepCount`, 
    [configData.schedule || 'none', configData.includeAttachments?1:0, configData.backupMode || 'incremental', 
     configData.sendEmail?1:0, configData.emailAddress || '', configData.useWebDAV?1:0, 
     configData.webdavUrl || '', configData.webdavUser || '', configData.webdavPassword || '',
     parseInt(configData.keepCount) || 0]);
  
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
  getBackupList
};
