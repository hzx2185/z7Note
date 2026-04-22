const version = 23;
const description = 'backfill notes createdAt column';

async function migrate(db) {
  if (!(await db.schema.hasTable('notes'))) return;

  if (!(await db.schema.hasColumn('notes', 'createdAt'))) {
    await db.exec('ALTER TABLE notes ADD COLUMN createdAt INTEGER');
  }

  await db.run(
    'UPDATE notes SET createdAt = COALESCE(NULLIF(createdAt, 0), updatedAt) WHERE createdAt IS NULL OR createdAt = 0'
  );
}

module.exports = {
  version,
  description,
  migrate
};
