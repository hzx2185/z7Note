const express = require('express');
const router = express.Router();
const config = require('../config');
const { getSystemConfig } = require('../services/systemConfig');
const {
  getUserBackupConfig,
  updateUserBackupConfig,
  performUserBackup,
  setupUserBackupCron
} = require('../services/userExport');

// 获取用户备份配置
router.get('/api/user/backup/config', async (req, res) => {
  try {
    const config = await getUserBackupConfig(req.user);
    res.json(config);
  } catch (e) {
    console.error('获取用户备份配置失败:', e);
    res.status(500).json({ error: '获取配置失败' });
  }
});

// 更新用户备份配置
router.post('/api/user/backup/config', async (req, res) => {
  try {
    const { enabled, schedule, sendEmail, emailAddress, webdavUrl, webdavUsername, webdavPassword, includeAttachments } = req.body;

    await updateUserBackupConfig(req.user, {
      enabled: enabled === true || enabled === 'true',
      schedule: schedule || '0 20 * * *',
      sendEmail: sendEmail === true || sendEmail === 'true',
      emailAddress,
      webdavUrl,
      webdavUsername,
      webdavPassword,
      includeAttachments: includeAttachments === true || includeAttachments === 'true'
    });

    // 重新设置定时任务
    const config = await getUserBackupConfig(req.user);
    setupUserBackupCron(req.user, config);

    res.json({ success: true });
  } catch (e) {
    console.error('更新用户备份配置失败:', e);
    res.status(500).json({ error: '保存配置失败' });
  }
});

// 测试 WebDAV 连接
router.post('/api/user/backup/test', async (req, res) => {
  try {
    const { webdavUrl, webdavUsername, webdavPassword } = req.body;

    if (!webdavUrl || !webdavUsername || !webdavPassword) {
      return res.status(400).json({ error: '请填写完整的 WebDAV 配置信息' });
    }

    console.log('[WebDAV 测试] 开始测试连接...', { url: webdavUrl, username: webdavUsername });

    const { createClient } = require('webdav');
    const client = createClient(webdavUrl, {
      username: webdavUsername,
      password: webdavPassword
    });

    // 测试连接：尝试获取根目录内容
    try {
      const contents = await client.getDirectoryContents('/');
      console.log('[WebDAV 测试] 连接成功，根目录内容:', contents);

      // 检查是否包含 z7note-backups 目录
      const hasBackupDir = contents.some(item => item.basename === 'z7note-backups' && item.type === 'directory');
      console.log('[WebDAV 测试] z7note-backups 目录存在:', hasBackupDir);

      // 尝试在 z7note-backups 目录下创建测试目录
      let canCreateDirectory = false;
      if (hasBackupDir) {
        try {
          const testDir = '/z7note-backups/test-' + Date.now();
          await client.createDirectory(testDir);
          await client.deleteDirectory(testDir);
          canCreateDirectory = true;
          console.log('[WebDAV 测试] 可以在 z7note-backups 目录下创建子目录');
        } catch (e) {
          console.log('[WebDAV 测试] 无法在 z7note-backups 目录下创建子目录:', e.message);
        }
      }

      res.json({
        success: true,
        message: 'WebDAV 连接测试成功',
        details: {
          canConnect: true,
          hasBackupDir: hasBackupDir,
          canCreateDirectory: canCreateDirectory,
          manualCreateNeeded: !canCreateDirectory
        }
      });
    } catch (e) {
      console.error('[WebDAV 测试] 连接失败:', e.message);
      res.status(500).json({
        error: 'WebDAV 连接失败，请检查 URL、用户名和密码',
        details: e.message
      });
    }
  } catch (e) {
    console.error('[WebDAV 测试] 测试失败:', e);
    res.status(500).json({ error: e.message || '测试失败' });
  }
});

// 立即备份
router.post('/api/user/backup/now', async (req, res) => {
  try {
    console.log('[立即备份] 开始处理备份请求');

    // 检查每日备份限制（优先使用系统配置，如果系统配置为0则不限制）
    const dailyBackupLimit = await getSystemConfig('dailyBackupLimit');
    const limit = parseInt(dailyBackupLimit) || config.dailyBackupLimit;

    if (limit > 0) {
      const savedConfig = await getUserBackupConfig(req.user);
      if (savedConfig.lastBackupTime) {
        const lastBackupDate = new Date(savedConfig.lastBackupTime);
        const today = new Date();
        const isSameDay = lastBackupDate.getFullYear() === today.getFullYear() &&
                         lastBackupDate.getMonth() === today.getMonth() &&
                         lastBackupDate.getDate() === today.getDate();

        if (isSameDay) {
          console.log(`[立即备份] 用户 ${req.user} 今日已备份过，拒绝请求`);
          return res.status(429).json({ error: '今日已备份过，每天只能备份一次' });
        }
      }
    }

    // 优先使用请求体中的配置（允许一次性覆盖）
    let config = req.body;
    if (!config || !config.webdavUrl) {
      // 如果请求体中没有配置，则从数据库获取保存的配置
      config = savedConfig;
    }

    if (!config.webdavUrl || !config.webdavUsername || !config.webdavPassword) {
      console.error('[立即备份] WebDAV 配置缺失');
      return res.status(400).json({ error: '请先配置 WebDAV 信息' });
    }

    // 确保配置包含所有必需字段
    const backupConfig = {
      webdavUrl: config.webdavUrl,
      webdavUsername: config.webdavUsername,
      webdavPassword: config.webdavPassword,
      includeAttachments: config.includeAttachments !== undefined ? config.includeAttachments : true,
      sendEmail: config.sendEmail !== undefined ? config.sendEmail : false,
      emailAddress: config.emailAddress || null
    };

    console.log(`[立即备份] 用户 ${req.user} 开始备份，包含附件: ${backupConfig.includeAttachments}`);

    const result = await performUserBackup(req.user, backupConfig);

    console.log(`[立即备份] 用户 ${req.user} 备份成功，文件数: ${result.fileCount}`);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[立即备份] 失败:', e);
    console.error('[立即备份] 错误堆栈:', e.stack);

    // 提供更详细的错误信息
    let errorMessage = '备份失败';
    if (e.message) {
      errorMessage = e.message;
    }
    if (e.response && e.response.status) {
      errorMessage += ` (HTTP ${e.response.status}: ${e.response.statusText})`;
    }

    res.status(500).json({ error: errorMessage });
  }
});

module.exports = router;
