/**
 * 为联系人表添加索引以优化查询性能
 */

const { connect, getConnection } = require('../db/sqlite-connection');

async function resolveDb(executor) {
  if (executor) {
    return executor;
  }

  await connect();
  return getConnection();
}

async function up(executor) {
  const db = await resolveDb(executor);

  // 添加用户+姓名索引（用于查询和去重）
  await db.run(
    'CREATE INDEX IF NOT EXISTS idx_contacts_username_fn ON contacts(username, fn)'
  );

  // 添加用户+创建时间索引（用于排序）
  await db.run(
    'CREATE INDEX IF NOT EXISTS idx_contacts_username_createdAt ON contacts(username, createdAt)'
  );

  console.log('联系人表索引创建成功');
}

async function down(executor) {
  const db = executor || getConnection();

  await db.run('DROP INDEX IF EXISTS idx_contacts_username_fn');
  await db.run('DROP INDEX IF EXISTS idx_contacts_username_createdAt');

  console.log('联系人表索引删除成功');
}

module.exports = {
  version: 21,
  description: '为联系人表补充姓名和创建时间索引',
  migrate: up,
  up,
  down
};
