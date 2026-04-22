const version = 30;
const description = 'add membership notice timestamps to users';

async function migrate(db) {
  if (!(await db.schema.hasColumn('users', 'membershipNoticeSentAt'))) {
    await db.exec('ALTER TABLE users ADD COLUMN membershipNoticeSentAt INTEGER DEFAULT 0');
  }

  if (!(await db.schema.hasColumn('users', 'membershipExpiredNoticeSentAt'))) {
    await db.exec('ALTER TABLE users ADD COLUMN membershipExpiredNoticeSentAt INTEGER DEFAULT 0');
  }
}

module.exports = {
  version,
  description,
  migrate
};
