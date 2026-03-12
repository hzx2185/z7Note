// 添加用户备份配置表
const { connect, getConnection } = require('../db/connection');

async function up() {
  await connect();
  const db = getConnection();
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_backup_config (
      username TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      schedule TEXT DEFAULT '0 20 * * *',
      sendEmail INTEGER DEFAULT 1,
      emailAddress TEXT,
      webdavUrl TEXT,
      webdavUsername TEXT,
      webdavPassword TEXT,
      includeAttachments INTEGER DEFAULT 1,
      lastBackupTime INTEGER DEFAULT 0,
      createdAt INTEGER DEFAULT (strftime('%s', 'now')),
      updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);
  
  console.log('[迁移] 用户备份配置表已创建');
}

async function down() {
  const db = getConnection();
  await db.exec('DROP TABLE IF EXISTS user_backup_config');
  console.log('[迁移] 用户备份配置表已删除');
}

module.exports = { up, down };
