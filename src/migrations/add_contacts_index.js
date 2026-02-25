/**
 * 为联系人表添加索引以优化查询性能
 */

const { getConnection } = require('../db/connection');

async function up() {
  const db = getConnection();

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

async function down() {
  const db = getConnection();

  await db.run('DROP INDEX IF EXISTS idx_contacts_username_fn');
  await db.run('DROP INDEX IF EXISTS idx_contacts_username_createdAt');

  console.log('联系人表索引删除成功');
}

module.exports = { up, down };
