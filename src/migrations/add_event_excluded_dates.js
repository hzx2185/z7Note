const version = 24;
const description = 'add events excludedDates column';

async function migrate(db) {
  if (!(await db.schema.hasTable('events'))) return;

  if (!(await db.schema.hasColumn('events', 'excludedDates'))) {
    await db.exec('ALTER TABLE events ADD COLUMN excludedDates TEXT');
  }
}

module.exports = {
  version,
  description,
  migrate
};
