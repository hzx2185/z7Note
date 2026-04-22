const express = require('express');
const router = express.Router();
const log = require('../utils/logger');
const {
  getUserBackupConfig,
  updateUserBackupConfig,
  performUserBackup,
  setupUserBackupCron
} = require('../services/userExport');
const { requirePlanCapability } = require('../middleware/memberAccess');

// 直接读取环境变量，避免模块初始化顺序问题
const dailyBackupLimit = parseInt(process.env.DAILY_BACKUP_LIMIT) || 0;

router.use(requirePlanCapability('backupExportEnabled', { message: '当前套餐未开启备份导出功能' }));
router.use('/test', requirePlanCapability('webdavEnabled', { message: '当前套餐未开启 WebDAV 功能' }));
router.use('/now', requirePlanCapability('webdavEnabled', { message: '当前套餐未开启 WebDAV 功能' }));
router.use('/config', requirePlanCapability('webdavEnabled', { message: '当前套餐未开启 WebDAV 功能' }));

// 获取用户备份配置
router.get('/config', async (req, res) => {
  try {
    const config = await getUserBackupConfig(req.user);
    res.json(config);
  } catch (e) {
    log('ERROR', '获取用户备份配置失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取配置失败' });
  }
});

// 更新用户备份配置
router.post('/config', async (req, res) => {
  try {
    const {
      enabled,
      schedule,
      sendEmail,
      emailAddress,
      webdavUrl,
      webdavUsername,
      webdavPassword,
      includeAttachments,
      includeCalendar,
      includeTodos,
      includeContacts,
      includeReminders
    } = req.body;

    await updateUserBackupConfig(req.user, {
      enabled: enabled === true || enabled === 'true',
      schedule: schedule || '0 20 * * *',
      sendEmail: sendEmail === true || sendEmail === 'true',
      emailAddress,
      webdavUrl,
      webdavUsername,
      webdavPassword,
      includeAttachments: includeAttachments === true || includeAttachments === 'true',
      includeCalendar: includeCalendar !== undefined ? (includeCalendar === true || includeCalendar === 'true') : true,
      includeTodos: includeTodos !== undefined ? (includeTodos === true || includeTodos === 'true') : true,
      includeContacts: includeContacts !== undefined ? (includeContacts === true || includeContacts === 'true') : true,
      includeReminders: includeReminders !== undefined ? (includeReminders === true || includeReminders === 'true') : true
    });

    // 重新设置定时任务
    const config = await getUserBackupConfig(req.user);
    setupUserBackupCron(req.user, config);

    res.json({ success: true });
  } catch (e) {
    log('ERROR', '更新用户备份配置失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '保存配置失败' });
  }
});

// 测试 WebDAV 连接
router.post('/test', async (req, res) => {
  try {
    const { webdavUrl, webdavUsername, webdavPassword } = req.body;

    if (!webdavUrl || !webdavUsername || !webdavPassword) {
      return res.status(400).json({ error: '请填写完整的 WebDAV 配置信息' });
    }

    const { createClient } = require('webdav');
    const client = createClient(webdavUrl, {
      username: webdavUsername,
      password: webdavPassword
    });

    // 测试连接：尝试获取根目录内容
    try {
      const contents = await client.getDirectoryContents('/');

      // 检查是否包含 z7note-backups 目录
      const hasBackupDir = contents.some(item => item.basename === 'z7note-backups' && item.type === 'directory');

      // 尝试在 z7note-backups 目录下创建测试目录
      let canCreateDirectory = false;
      if (hasBackupDir) {
        try {
          const testDir = '/z7note-backups/test-' + Date.now();
          await client.createDirectory(testDir);
          // 删除测试目录 - 使用 deleteFile 而不是 deleteDirectory
          await client.deleteFile(testDir);
          canCreateDirectory = true;
        } catch (e) {
          log('WARN', 'WebDAV 目录写入测试失败', { username: req.user, error: e.message });
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
      log('ERROR', 'WebDAV 连接测试失败', { username: req.user, error: e.message });
      res.status(500).json({
        error: 'WebDAV 连接失败，请检查 URL、用户名和密码',
        details: e.message
      });
    }
  } catch (e) {
    log('ERROR', 'WebDAV 测试失败', { username: req.user, error: e.message });
    res.status(500).json({ error: e.message || '测试失败' });
  }
});

// 立即备份
router.post('/now', async (req, res) => {
  try {
    // 检查每日备份限制（直接使用环境变量）
    const limit = dailyBackupLimit;

    if (limit > 0) {
      const savedConfig = await getUserBackupConfig(req.user);
      if (savedConfig.lastBackupTime) {
        const lastBackupDate = new Date(savedConfig.lastBackupTime);
        const today = new Date();
        const isSameDay = lastBackupDate.getFullYear() === today.getFullYear() &&
                         lastBackupDate.getMonth() === today.getMonth() &&
                         lastBackupDate.getDate() === today.getDate();

        if (isSameDay) {
          return res.status(429).json({ error: '今日已备份过，每天只能备份一次' });
        }
      }
    }

    // 优先使用请求体中的配置（允许一次性覆盖）
    let config = req.body;
    if (!config || !config.webdavUrl) {
      // 如果请求体中没有配置，则从数据库获取保存的配置
      const savedConfig = await getUserBackupConfig(req.user);
      config = savedConfig;
    }

    if (!config.webdavUrl || !config.webdavUsername || !config.webdavPassword) {
      log('WARN', '立即备份缺少 WebDAV 配置', { username: req.user });
      return res.status(400).json({ error: '请先配置 WebDAV 信息' });
    }

    // 确保配置包含所有必需字段
    const backupConfig = {
      webdavUrl: config.webdavUrl,
      webdavUsername: config.webdavUsername,
      webdavPassword: config.webdavPassword,
      includeAttachments: config.includeAttachments !== undefined ? config.includeAttachments : true,
      includeCalendar: config.includeCalendar !== undefined ? config.includeCalendar : true,
      includeTodos: config.includeTodos !== undefined ? config.includeTodos : true,
      includeContacts: config.includeContacts !== undefined ? config.includeContacts : true,
      includeReminders: config.includeReminders !== undefined ? config.includeReminders : true,
      sendEmail: config.sendEmail !== undefined ? config.sendEmail : false,
      emailAddress: config.emailAddress || null
    };

    const result = await performUserBackup(req.user, backupConfig);

    res.json({ success: true, ...result });
  } catch (e) {
    log('ERROR', '立即备份失败', { username: req.user, error: e.message });

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
