const config = require('../../config');
const { sqliteHasColumn } = require('../dialects/sqlite-introspection');
const { runMigrations } = require('./migrations');
const { SQLITE_DEFAULTS } = require('./sqlite-defaults');

async function applySqlitePragmas(db) {
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA synchronous = NORMAL');
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec('PRAGMA busy_timeout = 10000');
  await db.exec('PRAGMA cache_size = -64000');
  await db.exec('PRAGMA temp_store = MEMORY');
  await db.exec('PRAGMA mmap_size = 268435456');
}

async function createBaseTables(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT,
    email TEXT,
    dataCutoffTime INTEGER DEFAULT 0,
    noteLimit INTEGER DEFAULT ${config.defaultNoteLimit},
    fileLimit INTEGER DEFAULT ${config.defaultFileLimit},
    blogTitle TEXT,
    blogSubtitle TEXT,
    blogTheme TEXT DEFAULT 'light',
    blogShowHeader INTEGER DEFAULT 1,
    blogShowFooter INTEGER DEFAULT 1,
    customCSS TEXT,
    editorType TEXT DEFAULT 'codemirror'
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    username TEXT,
    title TEXT,
    content TEXT,
    updatedAt INTEGER,
    deleted INTEGER DEFAULT 0
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS reset_tokens (
    email TEXT,
    token TEXT,
    expires INTEGER
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS backup_config (
    id INTEGER PRIMARY KEY,
    schedule TEXT,
    includeAttachments INTEGER,
    backupMode TEXT DEFAULT 'incremental',
    sendEmail INTEGER,
    emailAddress TEXT,
    useWebDAV INTEGER,
    webdavUrl TEXT,
    webdavUser TEXT,
    webdavPassword TEXT,
    keepCount INTEGER DEFAULT 0
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS user_backup_config (
    username TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    schedule TEXT DEFAULT '0 20 * * *',
    sendEmail INTEGER DEFAULT 1,
    emailAddress TEXT,
    webdavUrl TEXT,
    webdavUsername TEXT,
    webdavPassword TEXT,
    includeAttachments INTEGER DEFAULT 1,
    lastBackupTime INTEGER DEFAULT 0,
    createdAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds},
    updatedAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds}
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    lastSeenAt INTEGER NOT NULL,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    owner TEXT,
    targetType TEXT,
    target TEXT,
    public INTEGER DEFAULT 1,
    password TEXT,
    expiresAt INTEGER DEFAULT 0,
    createdAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochMilliseconds}
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updatedAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds}
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS upload_chunks (
    id TEXT PRIMARY KEY,
    username TEXT,
    filename TEXT,
    totalSize INTEGER,
    chunkSize INTEGER,
    uploadedChunks TEXT,
    createdAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochMilliseconds},
    expiresAt INTEGER DEFAULT ${SQLITE_DEFAULTS.oneHourFromNowMilliseconds}
  )`);
}

async function createBaseIndexes(db) {
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_username ON notes(username)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updatedAt)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_username_deleted ON notes(username, deleted)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_username_updated ON notes(username, updatedAt)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_shares_public ON shares(public)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expiresAt)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_username ON user_sessions(username)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expiresAt)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_upload_chunks_username ON upload_chunks(username)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_upload_chunks_expires ON upload_chunks(expiresAt)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_backup_config_enabled ON user_backup_config(enabled)`);
}

async function migrateBaseSchema(db) {
  if (!(await sqliteHasColumn(db, 'users', 'noteLimit'))) {
    await db.exec(`ALTER TABLE users ADD COLUMN noteLimit INTEGER DEFAULT ${config.defaultNoteLimit}`);
    await db.exec(`ALTER TABLE users ADD COLUMN fileLimit INTEGER DEFAULT ${config.defaultFileLimit}`);
  }

  if (!(await sqliteHasColumn(db, 'users', 'blogTitle'))) {
    await db.exec(`ALTER TABLE users ADD COLUMN blogTitle TEXT`);
    await db.exec(`ALTER TABLE users ADD COLUMN blogSubtitle TEXT`);
    await db.exec(`ALTER TABLE users ADD COLUMN blogTheme TEXT DEFAULT 'light'`);
    await db.exec(`ALTER TABLE users ADD COLUMN blogShowHeader INTEGER DEFAULT 1`);
    await db.exec(`ALTER TABLE users ADD COLUMN blogShowFooter INTEGER DEFAULT 1`);
    await db.exec(`ALTER TABLE users ADD COLUMN customCSS TEXT`);
  }

  if (!(await sqliteHasColumn(db, 'users', 'editorType'))) {
    await db.exec(`ALTER TABLE users ADD COLUMN editorType TEXT DEFAULT 'codemirror'`);
  }

  if (!(await sqliteHasColumn(db, 'backup_config', 'backupMode'))) {
    await db.exec("ALTER TABLE backup_config ADD COLUMN backupMode TEXT DEFAULT 'incremental'");
  }
  if (!(await sqliteHasColumn(db, 'backup_config', 'keepCount'))) {
    await db.exec('ALTER TABLE backup_config ADD COLUMN keepCount INTEGER DEFAULT 0');
  }
}

async function ensureDefaultData(db) {
  const existingBackupConfig = await db.get('SELECT id FROM backup_config LIMIT 1');
  if (!existingBackupConfig) {
    await db.run(
      `INSERT INTO backup_config (id, schedule, includeAttachments, backupMode, sendEmail, emailAddress, useWebDAV, webdavUrl, webdavUser, webdavPassword)
      VALUES (1, '0 3 * * *', 1, 'incremental', 0, NULL, 0, NULL, NULL, NULL)`
    );
  }
}

async function initializeSqliteSchema(db) {
  await applySqlitePragmas(db);
  await createBaseTables(db);
  await createBaseIndexes(db);
  await migrateBaseSchema(db);
  await runMigrations(db);
  await ensureDefaultData(db);
}

module.exports = {
  applySqlitePragmas,
  createBaseTables,
  createBaseIndexes,
  migrateBaseSchema,
  ensureDefaultData,
  initializeSqliteSchema
};
