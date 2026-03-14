// 业务代码统一使用这个入口访问数据库。
// 运行时通过 DB_DIALECT 选择底层实现；当前仅启用 SQLite。
const config = require('../config');

const dialectLoaders = {
  sqlite: () => require('./dialects/sqlite')
};

function loadDialect(name) {
  const loader = dialectLoaders[name];
  if (!loader) {
    throw new Error(`未实现的数据库方言: ${name}`);
  }
  return loader();
}

const selectedDialect = config.database?.dialect || 'sqlite';
const dialect = loadDialect(selectedDialect);

module.exports = {
  dialect: selectedDialect,
  queryOne: dialect.queryOne,
  queryAll: dialect.queryAll,
  execute: dialect.execute,
  executeMany: dialect.executeMany,
  upsert: dialect.upsert,
  withTransaction: dialect.withTransaction,
  prepare: dialect.prepare,
  raw: dialect.raw,
  schema: dialect.schema,
  maintenance: dialect.maintenance
};
