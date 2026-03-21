const version = 24;

async function migrate(db) {
  if (!(await db.schema.hasTable('events'))) return;

  if (!(await db.schema.hasColumn('events', 'excludedDates'))) {
    await db.exec('ALTER TABLE events ADD COLUMN excludedDates TEXT');
  }
}

module.exports = {
  version,
  migrate
};
