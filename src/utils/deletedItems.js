const { toClientCalendarId } = require('./calendarIds');

function createDeletedItemId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function insertDeletedItem(executor, { username, itemId, type, deletedAt }) {
  await executor.execute(
    'INSERT INTO deleted_items (id, username, item_id, type, deletedAt) VALUES (?, ?, ?, ?, ?)',
    [createDeletedItemId(), username, toClientCalendarId(username, itemId), type, deletedAt]
  );
}

module.exports = {
  createDeletedItemId,
  insertDeletedItem
};
