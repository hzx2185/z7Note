const { SQLITE_DEFAULTS } = require('../db/schema/sqlite-defaults');

const version = 28;
const description = 'add redeem codes and redemption history tables';

async function migrate(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS redeem_codes (
    code TEXT PRIMARY KEY,
    planKey TEXT NOT NULL,
    noteLimit INTEGER NOT NULL,
    fileLimit INTEGER NOT NULL,
    maxRedemptions INTEGER DEFAULT 1,
    redeemedCount INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    expiresAt INTEGER DEFAULT 0,
    createdBy TEXT,
    createdAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds},
    updatedAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds}
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS redeem_code_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    username TEXT NOT NULL,
    planKey TEXT NOT NULL,
    noteLimit INTEGER NOT NULL,
    fileLimit INTEGER NOT NULL,
    redeemedAt INTEGER NOT NULL
  )`);

  await db.exec('CREATE INDEX IF NOT EXISTS idx_redeem_codes_enabled ON redeem_codes(enabled)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_redeem_codes_created_at ON redeem_codes(createdAt)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_redeem_redemptions_username ON redeem_code_redemptions(username)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_redeem_redemptions_code ON redeem_code_redemptions(code)');
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_redeem_redemptions_code_username ON redeem_code_redemptions(code, username)');
}

module.exports = {
  version,
  description,
  migrate
};
