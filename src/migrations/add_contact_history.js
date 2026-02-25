/**
 * 数据库迁移 - 添加联系人历史记录表
 */

module.exports = {
  up: async (db) => {
    // 创建修改历史表
    await db.run(`
      CREATE TABLE IF NOT EXISTS contact_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        field TEXT,
        old_value TEXT,
        new_value TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      )
    `);

    // 创建索引
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_contact_history_contact_id ON contact_history(contact_id)
    `);

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_contact_history_username ON contact_history(username)
    `);

    console.log('联系人历史记录表创建成功');
  },

  down: async (db) => {
    await db.run('DROP TABLE IF EXISTS contact_history');
    console.log('联系人历史记录表已删除');
  }
};
