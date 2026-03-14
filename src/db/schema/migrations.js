const fs = require('fs').promises;
const path = require('path');
const { sqliteHasTable, sqliteHasColumn, sqliteGetColumns } = require('../dialects/sqlite-introspection');
const { SQLITE_DEFAULTS } = require('./sqlite-defaults');

function createMigrationContext(db) {
  return {
    exec: db.exec.bind(db),
    run: db.run.bind(db),
    get: db.get.bind(db),
    all: db.all.bind(db),
    prepare: db.prepare.bind(db),
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
  const migrationDb = createMigrationContext(db);

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
      const migrationPath = path.join(migrationsPath, file);

      const existing = await db.get(
        'SELECT version FROM schema_migrations WHERE version = ?',
        [migration.version]
      );

      if (!existing) {
        console.log(`[Migration] Running migration ${migration.version}: ${migration.description}`);
        await migration.migrate(migrationDb);
        await db.run(
          'INSERT INTO schema_migrations (version, description) VALUES (?, ?)',
          [migration.version, migration.description]
        );
        console.log(`[Migration] Migration ${migration.version} completed`);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[Migration] Failed to run migrations:', error);
      throw error;
    }
  }
}

module.exports = {
  runMigrations
};
