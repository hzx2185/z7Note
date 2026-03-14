/**
 * 数据库迁移 - 添加重复事件功能
 */

module.exports = {
    version: 3,
    description: '添加重复事件字段',
    migrate: async (db) => {
        console.log('开始迁移: 添加重复事件字段...');

        const hasRecurrence = await db.schema.hasColumn('events', 'recurrence');

        if (!hasRecurrence) {
            // 添加重复事件相关字段
            await db.exec(`ALTER TABLE events ADD COLUMN recurrence TEXT`);
            await db.exec(`ALTER TABLE events ADD COLUMN recurrenceEnd INTEGER`);
            await db.exec(`ALTER TABLE events ADD COLUMN recurrenceCount INTEGER DEFAULT 0`);
            await db.exec(`ALTER TABLE events ADD COLUMN isRecurringMaster INTEGER DEFAULT 0`);
            await db.exec(`ALTER TABLE events ADD COLUMN parentEventId TEXT`);

            console.log('迁移完成: 重复事件字段已添加');
        } else {
            console.log('迁移跳过: 重复事件字段已存在');
        }
    }
};
