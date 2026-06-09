const { getCalendarIdCandidates, toClientCalendarId } = require('../utils/calendarIds');
const { parseMaterializedRecurringInstanceId } = require('../utils/calendarShadowEvents');
const { createDeletedItemId } = require('../utils/deletedItems');

module.exports = {
  version: 34,
  description: 'remove materialized recurring instance shadow events',
  migrate: async (db) => {
    if (!(await db.schema.hasTable('events')) || !(await db.schema.hasTable('deleted_items'))) {
      return;
    }

    const rows = await db.all(
      `SELECT id, username FROM events
       WHERE recurrence IS NULL OR recurrence = ''`
    );

    const now = Math.floor(Date.now() / 1000);
    let removed = 0;
    let skipped = 0;

    for (const row of rows) {
      const materializedInstance = parseMaterializedRecurringInstanceId(row.username, row.id);
      if (!materializedInstance) {
        skipped++;
        continue;
      }

      const candidates = getCalendarIdCandidates(row.username, materializedInstance.parentId);
      const placeholders = candidates.map(() => '?').join(',');
      const master = await db.get(
        `SELECT id FROM events
         WHERE username = ?
           AND recurrence IS NOT NULL
           AND recurrence != ''
           AND id IN (${placeholders})
         LIMIT 1`,
        [row.username, ...candidates]
      );

      if (!master) {
        skipped++;
        continue;
      }

      const clientItemId = toClientCalendarId(row.username, row.id);
      const existingDeletedItem = await db.get(
        `SELECT id FROM deleted_items
         WHERE username = ? AND item_id = ? AND type = 'event'
         LIMIT 1`,
        [row.username, clientItemId]
      );

      if (!existingDeletedItem) {
        await db.run(
          'INSERT INTO deleted_items (id, username, item_id, type, deletedAt) VALUES (?, ?, ?, ?, ?)',
          [createDeletedItemId(), row.username, clientItemId, 'event', now]
        );
      }

      await db.run('DELETE FROM events WHERE id = ? AND username = ?', [row.id, row.username]);
      removed++;
    }

    db.log('迁移完成: 已移除重复实例影子事件', { removed, skipped });
  }
};
