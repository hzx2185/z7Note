const fs = require('fs').promises;
const path = require('path');
const { sqliteHasTable, sqliteHasColumn, sqliteGetColumns } = require('../dialects/sqlite-introspection');
const { SQLITE_DEFAULTS } = require('./sqlite-defaults');
const log = require('../../utils/logger');

function createMigrationContext(db, logger) {
  return {
    exec: db.exec.bind(db),
    run: db.run.bind(db),
    get: db.get.bind(db),
    all: db.all.bind(db),
    prepare: db.prepare.bind(db),
    log: (message, extra) => logger('INFO', message, extra),
    warn: (message, extra) => logger('WARN', message, extra),
    error: (message, extra) => logger('ERROR', message, extra),
    schema: {
      hasTable: (tableName) => sqliteHasTable(db, tableName),
      hasColumn: (tableName, columnName) => sqliteHasColumn(db, tableName, columnName),
      getColumns: (tableName) => sqliteGetColumns(db, tableName)
    }
  };
}

async function ensureMigrationTable(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT,
    appliedAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds}
  )`);
}

async function runMigrations(db) {
  const migrationsPath = path.join(__dirname, '../../migrations');

  await ensureMigrationTable(db);

  try {
    const migrationFiles = (await fs.readdir(migrationsPath)).filter((file) => file.endsWith('.js'));
    const migrations = [];

    for (const file of migrationFiles) {
      const migrationPath = path.join(migrationsPath, file);
      const migration = require(migrationPath);

      if (!migration.version || !migration.migrate) {
        continue;
      }

      migrations.push({ file, migration });
    }

    migrations.sort((a, b) => a.migration.version - b.migration.version);

    for (const { file, migration } of migrations) {
      const existing = await db.get(
        'SELECT version FROM schema_migrations WHERE version = ?',
        [migration.version]
      );

      if (!existing) {
        const description = migration.description || file;
        const migrationLogger = (level, message, extra = {}) => {
          log(level, '执行数据库迁移', {
            phase: 'migration',
            version: migration.version,
            description,
            file,
            detail: message,
            ...extra
          });
        };
        const migrationDb = createMigrationContext(db, migrationLogger);

        migrationLogger('INFO', '开始执行迁移');
        await migration.migrate(migrationDb);

        await db.run(
          'INSERT INTO schema_migrations (version, description) VALUES (?, ?)',
          [migration.version, description]
        );
        migrationLogger('INFO', '迁移执行完成');
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('ERROR', '数据库迁移执行失败', {
        phase: 'migration',
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = {
  runMigrations
};
