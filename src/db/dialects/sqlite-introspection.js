async function sqliteHasTable(db, tableName) {
  const result = await db.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  );
  return Boolean(result);
}

async function sqliteGetColumns(db, tableName) {
  return db.all(`PRAGMA table_info(${tableName})`);
}

async function sqliteHasColumn(db, tableName, columnName) {
  const columns = await sqliteGetColumns(db, tableName);
  return columns.some((column) => column.name === columnName);
}

module.exports = {
  sqliteHasTable,
  sqliteHasColumn,
  sqliteGetColumns
};
