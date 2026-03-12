/**
 * 数据库迁移 - 扩展用户备份配置，支持更多数据类型备份
 */

module.exports = {
    version: 10,
    description: '扩展用户备份配置，支持日历、待办、联系人、提醒设置备份',
    migrate: async (db) => {
        console.log('开始迁移: 扩展用户备份配置...');

        // 检查 user_backup_config 表是否存在
        const tableExists = await db.get(`
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='user_backup_config'
        `);

        if (!tableExists) {
            console.log('user_backup_config 表不存在，跳过迁移');
            return;
        }

        // 获取表结构
        const tableInfo = await db.all("PRAGMA table_info(user_backup_config)");

        // 检查并添加字段
        const fieldsToAdd = [
            { name: 'includeCalendar', sql: 'includeCalendar INTEGER DEFAULT 1' },
            { name: 'includeTodos', sql: 'includeTodos INTEGER DEFAULT 1' },
            { name: 'includeContacts', sql: 'includeContacts INTEGER DEFAULT 1' },
            { name: 'includeReminders', sql: 'includeReminders INTEGER DEFAULT 1' }
        ];

        for (const field of fieldsToAdd) {
            const exists = tableInfo.some(col => col.name === field.name);
            if (!exists) {
                try {
                    await db.exec(`ALTER TABLE user_backup_config ADD COLUMN ${field.sql}`);
                    console.log(`添加字段: ${field.name}`);
                } catch (e) {
                    console.error(`添加字段 ${field.name} 失败:`, e.message);
                }
            } else {
                console.log(`字段 ${field.name} 已存在，跳过`);
            }
        }

        console.log('迁移完成: 用户备份配置已扩展');
    }
};
