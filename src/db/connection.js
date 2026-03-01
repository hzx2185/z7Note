const { open } = require('sqlite');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');

const dbConfig = {
  filename: path.join(config.paths.data, 'z7note.db'),
  driver: sqlite3.Database,
  mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_FULLMUTEX
};

let db = null;

async function connect() {
  if (db) return db;
  
  await fs.mkdir(config.paths.uploads, { recursive: true });
  await fs.mkdir(config.paths.backups, { recursive: true });
  
  db = await open(dbConfig);
  
  // 性能优化设置
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA synchronous = NORMAL');
  await db.exec('PRAGMA foreign_keys = ON');
  
  // 创建表结构
  await createTables();
  
  return db;
}

async function createTables() {
  // 用户表
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

  // 笔记表
  await db.exec(`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    username TEXT,
    title TEXT,
    content TEXT,
    updatedAt INTEGER,
    deleted INTEGER DEFAULT 0
  )`);

  // 密码重置令牌表
  await db.exec(`CREATE TABLE IF NOT EXISTS reset_tokens (
    email TEXT,
    token TEXT,
    expires INTEGER
  )`);

  // 备份配置表（管理员）
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
    webdavPassword TEXT
  )`);

  // 用户备份配置表
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
    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  // 分享表
  await db.exec(`CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    owner TEXT,
    targetType TEXT,
    target TEXT,
    public INTEGER DEFAULT 1,
    password TEXT,
    expiresAt INTEGER DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s','now')*1000)
  )`);

  // 系统配置表
  await db.exec(`CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updatedAt INTEGER DEFAULT (strftime('%s','now')*1000)
  )`);

  // 分片上传临时表
  await db.exec(`CREATE TABLE IF NOT EXISTS upload_chunks (
    id TEXT PRIMARY KEY,
    username TEXT,
    filename TEXT,
    totalSize INTEGER,
    chunkSize INTEGER,
    uploadedChunks TEXT,
    createdAt INTEGER DEFAULT (strftime('%s','now')*1000),
    expiresAt INTEGER DEFAULT ((strftime('%s','now')*1000) + 3600000)
  )`);

  // 创建迁移记录表
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT,
    appliedAt INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  // 创建索引
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_username ON notes(username)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updatedAt)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_username_deleted ON notes(username, deleted)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_username_updated ON notes(username, updatedAt)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_shares_public ON shares(public)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expiresAt)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_upload_chunks_username ON upload_chunks(username)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_upload_chunks_expires ON upload_chunks(expiresAt)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_backup_config_enabled ON user_backup_config(enabled)`);

  // 检查并添加新列
  await migrateSchema();

  // 运行迁移脚本
  await runMigrations();

  // 初始化默认备份配置（如果表为空）
  const existingBackupConfig = await db.get('SELECT rowid FROM backup_config LIMIT 1');
  if (!existingBackupConfig) {
    await db.run(
      `INSERT INTO backup_config (id, schedule, includeAttachments, backupMode, sendEmail, emailAddress, useWebDAV, webdavUrl, webdavUser, webdavPassword)
      VALUES (1, '0 3 * * *', 1, 'incremental', 0, NULL, 0, NULL, NULL, NULL)`
    );
  }
}

async function migrateSchema() {
  const tableInfo = await db.all("PRAGMA table_info(users)");
  const columns = tableInfo.map(c => c.name);

  if (!columns.includes('noteLimit')) {
    await db.exec(`ALTER TABLE users ADD COLUMN noteLimit INTEGER DEFAULT ${config.defaultNoteLimit}`);
    await db.exec(`ALTER TABLE users ADD COLUMN fileLimit INTEGER DEFAULT ${config.defaultFileLimit}`);
  }

  if (!columns.includes('blogTitle')) {
    await db.exec(`ALTER TABLE users ADD COLUMN blogTitle TEXT`);
    await db.exec(`ALTER TABLE users ADD COLUMN blogSubtitle TEXT`);
    await db.exec(`ALTER TABLE users ADD COLUMN blogTheme TEXT DEFAULT 'light'`);
    await db.exec(`ALTER TABLE users ADD COLUMN blogShowHeader INTEGER DEFAULT 1`);
    await db.exec(`ALTER TABLE users ADD COLUMN blogShowFooter INTEGER DEFAULT 1`);
    await db.exec(`ALTER TABLE users ADD COLUMN customCSS TEXT`);
  }

  if (!columns.includes('editorType')) {
    await db.exec(`ALTER TABLE users ADD COLUMN editorType TEXT DEFAULT 'codemirror'`);
  }

  // 检查 backup_config 的新列
  const backupTableInfo = await db.all("PRAGMA table_info(backup_config)");
  const backupColumns = backupTableInfo.map(c => c.name);
  if (!backupColumns.includes('backupMode')) {
    await db.exec("ALTER TABLE backup_config ADD COLUMN backupMode TEXT DEFAULT 'incremental'");
  }
}

async function runMigrations() {
  const migrationsPath = path.join(__dirname, '../migrations');
  
  try {
    const migrationFiles = (await fs.readdir(migrationsPath)).filter(f => f.endsWith('.js'));

    for (const file of migrationFiles) {
      const migrationPath = path.join(migrationsPath, file);
      const migration = require(migrationPath);

      if (!migration.version || !migration.migrate) {
        continue;
      }

      const existing = await db.get('SELECT version FROM schema_migrations WHERE version = ?', [migration.version]);

      if (!existing) {
        console.log(`[Migration] Running migration ${migration.version}: ${migration.description}`);
        await migration.migrate(db);
        await db.run('INSERT INTO schema_migrations (version, description) VALUES (?, ?)', [migration.version, migration.description]);
        console.log(`[Migration] Migration ${migration.version} completed`);
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('[Migration] Failed to run migrations:', e);
    }
  }
}

function getConnection() {
  return db;
}

async function close() {
  if (db) {
    await db.close();
    db = null;
  }
}

module.exports = {
  connect,
  getConnection,
  close
};
