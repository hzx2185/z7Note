const version = 32;
const description = 'add note version history';

async function migrate(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS note_versions (
      id TEXT PRIMARY KEY,
      noteId TEXT NOT NULL,
      username TEXT NOT NULL,
      title TEXT,
      content TEXT,
      contentHash TEXT,
      source TEXT DEFAULT 'auto',
      noteUpdatedAt INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL
    )
  `);

  await db.exec('CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(username, noteId, createdAt)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_note_versions_created ON note_versions(createdAt)');
}

module.exports = {
  version,
  description,
  migrate
};
