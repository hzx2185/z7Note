/**
 * 数据库迁移 - 添加日历订阅功能
 */
const { SQLITE_DEFAULTS } = require('../db/schema/sqlite-defaults');

module.exports = {
    version: 4,
    description: '添加日历订阅表',
    migrate: async (db) => {
        console.log('开始迁移: 添加日历订阅表...');

        // 创建日历订阅表
        await db.exec(`CREATE TABLE IF NOT EXISTS calendar_subscriptions (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            color TEXT DEFAULT '#6366f1',
            lastSync INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            createdAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds},
            updatedAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds}
        )`);

        // 为订阅表添加索引
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_subscriptions_username ON calendar_subscriptions(username)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_subscriptions_enabled ON calendar_subscriptions(enabled)`);

        // 为events表添加subscriptionId字段以标识事件来源
        if (!(await db.schema.hasColumn('events', 'subscriptionId'))) {
            await db.exec(`ALTER TABLE events ADD COLUMN subscriptionId TEXT`);
        }

        console.log('迁移完成: 日历订阅表已创建');
    }
};
