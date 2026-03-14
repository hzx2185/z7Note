module.exports = {
  version: 22,
  description: '将联系人历史表的 contact_id 规范为 TEXT',
  migrate: async (db) => {
    if (!(await db.schema.hasTable('contact_history'))) {
      return;
    }

    const columns = await db.schema.getColumns('contact_history');
    const contactIdColumn = columns.find((column) => column.name === 'contact_id');

    if (!contactIdColumn) {
      return;
    }

    if ((contactIdColumn.type || '').toUpperCase() === 'TEXT') {
      return;
    }

    console.log('开始迁移: 规范 contact_history.contact_id 为 TEXT...');

    await db.exec('BEGIN TRANSACTION');

    try {
      await db.exec(`
        CREATE TABLE contact_history_new (
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

      await db.exec(`
        INSERT INTO contact_history_new (id, contact_id, username, action, field, old_value, new_value, created_at)
        SELECT id, CAST(contact_id AS TEXT), username, action, field, old_value, new_value, created_at
        FROM contact_history
      `);

      await db.exec('DROP TABLE contact_history');
      await db.exec('ALTER TABLE contact_history_new RENAME TO contact_history');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_contact_history_contact_id ON contact_history(contact_id)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_contact_history_username ON contact_history(username)');

      await db.exec('COMMIT');
      console.log('迁移完成: contact_history.contact_id 已规范为 TEXT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
};
