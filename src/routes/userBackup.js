const express = require('express');
const router = express.Router();
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

// 立即备份
router.post('/api/user/backup/now', async (req, res) => {
  try {
    const config = await getUserBackupConfig(req.user);

    if (!config.webdavUrl || !config.webdavUsername || !config.webdavPassword) {
      return res.status(400).json({ error: '请先配置 WebDAV 信息' });
    }

    const result = await performUserBackup(req.user, config);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('立即备份失败:', e);
    res.status(500).json({ error: e.message || '备份失败' });
  }
});

module.exports = router;
