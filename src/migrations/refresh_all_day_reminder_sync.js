const version = 26;
const description = 'refresh all-day reminder sync timestamps';

async function migrate(db) {
  if (!(await db.schema.hasTable('events'))) {
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  await db.run(
    `UPDATE events
     SET updatedAt = ?
     WHERE allDay = 1
       AND reminderPreset IN ('same_day_9am', 'one_day_9am')
       AND (
         COALESCE(reminderBrowser, 0) = 1 OR
         COALESCE(reminderEmail, 0) = 1 OR
         COALESCE(reminderCaldav, 0) = 1
       )`,
    [now]
  );
}

module.exports = {
  version,
  description,
  migrate
};
