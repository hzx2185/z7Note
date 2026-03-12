/**
 * 数据库迁移 - 统一时间戳精度为秒级
 */

module.exports = {
    version: 14,
    description: '将所有表的 updatedAt 统一为秒级整数',
    migrate: async (db) => {
        console.log('开始迁移: 统一时间戳精度...');

        const tables = ['events', 'todos', 'notes', 'users', 'user_backup_config', 'system_config'];
        
        for (const table of tables) {
            try {
                // 如果 updatedAt > 2000000000，说明是毫秒级，转换为秒级
                await db.exec(`UPDATE ${table} SET updatedAt = CAST(updatedAt / 1000 AS INTEGER) WHERE updatedAt > 2000000000000`);
                // 也要处理 1.7e12 这种规模的 ms
                await db.exec(`UPDATE ${table} SET updatedAt = CAST(updatedAt / 1000 AS INTEGER) WHERE updatedAt > 10000000000`);
                console.log(`表 ${table} 时间戳迁移完成`);
            } catch (e) {
                console.warn(`迁移表 ${table} 失败 (可能不存在):`, e.message);
            }
        }

        console.log('迁移完成: 时间戳精度已统一为秒级');
    }
};
