// SQLite 底层连接与建表初始化。
// 约定：业务代码优先通过 src/db/client.js 访问数据库，
// 这里只给 DB dialect、启动初始化和迁移脚本使用。
const { open } = require('sqlite');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const { initializeSqliteSchema } = require('./schema/sqlite');

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

  await initializeSqliteSchema(db);

  return db;
}

function getConnection() {
  if (!db) {
    throw new Error('Database not connected');
  }
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
