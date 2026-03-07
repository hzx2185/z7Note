const { scopeExternalCalendarId, shouldScopeLegacyCalendarId } = require('../utils/calendarIds');

module.exports = {
  version: 17,
  description: '为历史外部日历 ID 增加用户命名空间',
  migrate: async (db) => {
    console.log('开始迁移: 回填历史日历外部 ID 命名空间...');

    const rewriteTableIds = async (tableName) => {
      const rows = await db.all(`SELECT id, username FROM ${tableName}`);
      let migrated = 0;
      let skipped = 0;

      for (const row of rows) {
        if (!shouldScopeLegacyCalendarId(row.id)) {
          continue;
        }

        const scopedId = scopeExternalCalendarId(row.username, row.id);
        if (scopedId === row.id) {
          continue;
        }

        const existing = await db.get(`SELECT id FROM ${tableName} WHERE id = ?`, [scopedId]);
        if (existing) {
          skipped++;
          continue;
        }

        await db.run(`UPDATE ${tableName} SET id = ? WHERE id = ? AND username = ?`, [scopedId, row.id, row.username]);
        migrated++;
      }

      return { migrated, skipped };
    };

    const eventStats = await rewriteTableIds('events');
    const todoStats = await rewriteTableIds('todos');

    console.log('迁移完成: 历史日历外部 ID 已回填', {
      eventsMigrated: eventStats.migrated,
      eventsSkipped: eventStats.skipped,
      todosMigrated: todoStats.migrated,
      todosSkipped: todoStats.skipped
    });
  }
};
