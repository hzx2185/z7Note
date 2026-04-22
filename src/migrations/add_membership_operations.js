const version = 31;
const description = 'add membership operations log';

async function migrate(db) {
  if (!(await db.schema.hasTable('membership_operations'))) {
    await db.exec(`CREATE TABLE membership_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      operator TEXT,
      source TEXT,
      planKey TEXT NOT NULL,
      noteLimit INTEGER NOT NULL,
      fileLimit INTEGER NOT NULL,
      durationDays INTEGER DEFAULT 0,
      planExpiresAt INTEGER DEFAULT 0,
      redeemCode TEXT,
      details TEXT,
      createdAt INTEGER NOT NULL
    )`);
  }

  await db.exec('CREATE INDEX IF NOT EXISTS idx_membership_operations_username ON membership_operations(username)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_membership_operations_created_at ON membership_operations(createdAt)');
}

module.exports = {
  version,
  description,
  migrate
};
