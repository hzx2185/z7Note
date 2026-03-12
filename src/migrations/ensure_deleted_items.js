module.exports = {
  version: 16,
  description: '确保 deleted_items 表及索引存在',
  migrate: async (db) => {
    console.log('开始迁移: 检查 deleted_items 表...');

    await db.exec(`CREATE TABLE IF NOT EXISTS deleted_items (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      item_id TEXT NOT NULL,
      type TEXT NOT NULL,
      deletedAt INTEGER NOT NULL
    )`);

    await db.exec('CREATE INDEX IF NOT EXISTS idx_deleted_items_user_deleted_at ON deleted_items(username, deletedAt)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_deleted_items_user_item ON deleted_items(username, item_id)');

    console.log('迁移完成: deleted_items 表已就绪');
  }
};
