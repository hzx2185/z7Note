module.exports = {
  version: 18,
  description: '统一系统配置与用户备份配置时间戳为秒级',
  migrate: async (db) => {
    console.log('开始迁移: 统一配置时间戳...');

    await db.exec("UPDATE user_backup_config SET updatedAt = CAST(updatedAt / 1000 AS INTEGER) WHERE updatedAt > 10000000000");
    await db.exec("UPDATE user_backup_config SET lastBackupTime = CAST(lastBackupTime / 1000 AS INTEGER) WHERE lastBackupTime > 10000000000");
    await db.exec("UPDATE system_config SET updatedAt = CAST(updatedAt / 1000 AS INTEGER) WHERE updatedAt > 10000000000");

    console.log('迁移完成: 配置时间戳已统一为秒级');
  }
};
