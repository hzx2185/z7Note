const version = 25;
const description = 'add reminder preset fields';

async function migrate(db) {
  if (await db.schema.hasTable('events') && !(await db.schema.hasColumn('events', 'reminderPreset'))) {
    await db.exec('ALTER TABLE events ADD COLUMN reminderPreset TEXT');
  }

  if (await db.schema.hasTable('todos') && !(await db.schema.hasColumn('todos', 'reminderPreset'))) {
    await db.exec('ALTER TABLE todos ADD COLUMN reminderPreset TEXT');
  }

  if (await db.schema.hasTable('events')) {
    await db.exec(`
      UPDATE events
      SET reminderPreset = CASE WHEN allDay = 1 THEN 'same_day_9am' ELSE '15m' END
      WHERE reminderPreset IS NULL OR trim(reminderPreset) = ''
    `);
  }

  if (await db.schema.hasTable('todos')) {
    await db.exec(`
      UPDATE todos
      SET reminderPreset = CASE WHEN allDay = 1 THEN 'same_day_9am' ELSE '15m' END
      WHERE reminderPreset IS NULL OR trim(reminderPreset) = ''
    `);
  }
}

module.exports = {
  version,
  description,
  migrate
};
