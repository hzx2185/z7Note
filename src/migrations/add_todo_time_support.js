/**
 * 数据库迁移 - 为待办事项增加全天和开始时间支持
 */

module.exports = {
    version: 15,
    description: '为待办事项增加 allDay 和 startTime 字段',
    migrate: async (db) => {
        console.log('开始迁移: 为 todos 增加 allDay 和 startTime 字段...');

        try {
            // 增加 allDay 字段 (0: 非全天, 1: 全天)
            await db.exec('ALTER TABLE todos ADD COLUMN allDay INTEGER DEFAULT 1');
            // 增加 startTime 字段 (Unix 时间戳)
            await db.exec('ALTER TABLE todos ADD COLUMN startTime INTEGER');
            
            console.log('迁移完成: todos 表结构已更新');
        } catch (e) {
            if (e.message.includes('duplicate column name')) {
                console.log('字段已存在，跳过迁移');
            } else {
                throw e;
            }
        }
    }
};
