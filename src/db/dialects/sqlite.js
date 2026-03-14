const { getConnection } = require('../sqlite-connection');
const { sqliteHasTable, sqliteHasColumn, sqliteGetColumns } = require('./sqlite-introspection');

function getDb() {
  return getConnection();
}

function buildPlaceholders(count) {
  return new Array(count).fill('?').join(', ');
}

function buildUpsertStatement(table, insertData = {}, updateFields = [], conflictKeys = []) {
  const columns = Object.keys(insertData);
  if (columns.length === 0) {
    throw new Error('upsert requires at least one insert field');
  }
  if (!Array.isArray(conflictKeys) || conflictKeys.length === 0) {
    throw new Error('upsert requires at least one conflict key');
  }

  const placeholders = buildPlaceholders(columns.length);
  const conflictClause = conflictKeys.join(', ');
  const params = columns.map((column) => insertData[column]);

  let sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
  if (updateFields.length > 0) {
    const updateClause = updateFields
      .map((field) => `${field}=excluded.${field}`)
      .join(', ');
    sql += ` ON CONFLICT(${conflictClause}) DO UPDATE SET ${updateClause}`;
  } else {
    sql += ` ON CONFLICT(${conflictClause}) DO NOTHING`;
  }

  return { sql, params };
}

async function queryOne(sql, params = []) {
  return getDb().get(sql, params);
}

async function queryAll(sql, params = []) {
  return getDb().all(sql, params);
}

async function execute(sql, params = []) {
  return getDb().run(sql, params);
}

async function executeMany(statements = []) {
  const db = getDb();
  await db.run('BEGIN TRANSACTION');
  try {
    const results = [];
    for (const statement of statements) {
      results.push(await db.run(statement.sql, statement.params || []));
    }
    await db.run('COMMIT');
    return results;
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

async function upsert(table, insertData = {}, updateFields = [], conflictKeys = []) {
  const statement = buildUpsertStatement(table, insertData, updateFields, conflictKeys);
  return execute(statement.sql, statement.params);
}

async function hasTable(tableName) {
  return sqliteHasTable(getDb(), tableName);
}

async function hasColumn(tableName, columnName) {
  return sqliteHasColumn(getDb(), tableName, columnName);
}

async function getColumns(tableName) {
  return sqliteGetColumns(getDb(), tableName);
}

async function compact() {
  await getDb().run('VACUUM');
}

async function getStorageStats() {
  const db = getDb();
  const [pageCount, pageSize, freelistCount] = await Promise.all([
    db.get('PRAGMA page_count'),
    db.get('PRAGMA page_size'),
    db.get('PRAGMA freelist_count')
  ]);

  const pageCountValue = pageCount?.page_count || 0;
  const pageSizeValue = pageSize?.page_size || 0;
  const freelistValue = freelistCount?.freelist_count || 0;
  const totalBytes = pageCountValue * pageSizeValue;
  const freeBytes = freelistValue * pageSizeValue;

  return {
    pageCount: pageCountValue,
    pageSize: pageSizeValue,
    freelistCount: freelistValue,
    totalBytes,
    freeBytes,
    usedBytes: Math.max(totalBytes - freeBytes, 0)
  };
}

async function withTransaction(callback) {
  const db = getDb();
  await db.run('BEGIN TRANSACTION');
  try {
    const tx = {
      queryOne: (sql, params = []) => db.get(sql, params),
      queryAll: (sql, params = []) => db.all(sql, params),
      execute: (sql, params = []) => db.run(sql, params),
      upsert: (table, insertData = {}, updateFields = [], conflictKeys = []) => {
        const statement = buildUpsertStatement(table, insertData, updateFields, conflictKeys);
        return db.run(statement.sql, statement.params);
      },
      prepare: (sql) => db.prepare(sql),
      raw: () => db
    };
    const result = await callback(tx);
    await db.run('COMMIT');
    return result;
  } catch (error) {
    try {
      await db.run('ROLLBACK');
    } catch (rollbackError) {
      rollbackError.cause = error;
      throw rollbackError;
    }
    throw error;
  }
}

function prepare(sql) {
  return getDb().prepare(sql);
}

function raw() {
  return getDb();
}

module.exports = {
  queryOne,
  queryAll,
  execute,
  executeMany,
  upsert,
  withTransaction,
  prepare,
  raw,
  schema: {
    hasTable,
    hasColumn,
    getColumns
  },
  maintenance: {
    compact,
    getStorageStats
  }
};
