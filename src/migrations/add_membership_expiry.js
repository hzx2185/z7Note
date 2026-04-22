const version = 29;
const description = 'add membership expiry support for users and redeem codes';

async function migrate(db) {
  if (!(await db.schema.hasColumn('users', 'planExpiresAt'))) {
    await db.exec('ALTER TABLE users ADD COLUMN planExpiresAt INTEGER DEFAULT 0');
  }

  if (await db.schema.hasTable('redeem_codes') && !(await db.schema.hasColumn('redeem_codes', 'durationDays'))) {
    await db.exec('ALTER TABLE redeem_codes ADD COLUMN durationDays INTEGER DEFAULT 0');
  }

  if (await db.schema.hasTable('redeem_code_redemptions')) {
    if (!(await db.schema.hasColumn('redeem_code_redemptions', 'durationDays'))) {
      await db.exec('ALTER TABLE redeem_code_redemptions ADD COLUMN durationDays INTEGER DEFAULT 0');
    }
    if (!(await db.schema.hasColumn('redeem_code_redemptions', 'planExpiresAt'))) {
      await db.exec('ALTER TABLE redeem_code_redemptions ADD COLUMN planExpiresAt INTEGER DEFAULT 0');
    }
  }
}

module.exports = {
  version,
  description,
  migrate
};
