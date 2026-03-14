// 添加用户备份配置表
const { connect, getConnection } = require('../db/sqlite-connection');
const { SQLITE_DEFAULTS } = require('../db/schema/sqlite-defaults');

async function resolveDb(executor) {
  if (executor) {
    return executor;
  }

  await connect();
  return getConnection();
}

async function up(executor) {
  const db = await resolveDb(executor);
  
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
      createdAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds},
      updatedAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds}
    )
  `);
  
  console.log('[迁移] 用户备份配置表已创建');
}

async function down(executor) {
  const db = executor || getConnection();
  await db.exec('DROP TABLE IF EXISTS user_backup_config');
  console.log('[迁移] 用户备份配置表已删除');
}

module.exports = {
  version: 11,
  description: '确保用户备份配置表存在',
  migrate: up,
  up,
  down
};
