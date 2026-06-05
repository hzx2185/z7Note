const { SQLITE_DEFAULTS } = require('../db/schema/sqlite-defaults');

const version = 33;
const description = 'add per-user preferences table';

async function migrate(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS user_preferences (
    username TEXT NOT NULL,
    settingKey TEXT NOT NULL,
    value TEXT,
    createdAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds},
    updatedAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds},
    PRIMARY KEY (username, settingKey),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  )`);

  await db.exec('CREATE INDEX IF NOT EXISTS idx_user_preferences_username ON user_preferences(username)');
}

module.exports = {
  version,
  description,
  migrate
};
