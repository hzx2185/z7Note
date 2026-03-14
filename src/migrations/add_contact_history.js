/**
 * 数据库迁移 - 添加联系人历史记录表
 */

async function up(db) {
  // 历史记录允许保留已删除联系人的变更痕迹，因此不做外键约束。
  await db.run(`
    CREATE TABLE IF NOT EXISTS contact_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id TEXT NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_contact_history_contact_id ON contact_history(contact_id)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_contact_history_username ON contact_history(username)
  `);

  console.log('联系人历史记录表创建成功');
}

async function down(db) {
  await db.run('DROP TABLE IF EXISTS contact_history');
  console.log('联系人历史记录表已删除');
}

module.exports = {
  version: 12,
  description: '添加联系人历史记录表',
  migrate: up,
  up,
  down
};
