/**
 * 数据库迁移 - 为事件表添加时区字段
 */

module.exports = {
    version: 6,
    description: '为事件表添加时区字段',
    migrate: async (db) => {
        console.log('开始迁移: 为事件表添加时区字段...');

        const hasTimezone = await db.schema.hasColumn('events', 'timezone');

        if (!hasTimezone) {
            // 如果不存在，则添加 timezone 字段
            await db.exec(`ALTER TABLE events ADD COLUMN timezone TEXT`);
            console.log('迁移完成: events.timezone 字段已添加');
        } else {
            console.log('迁移跳过: events.timezone 字段已存在');
        }
    }
};
