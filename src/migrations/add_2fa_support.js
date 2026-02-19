/**
 * 数据库迁移 - 添加2FA（两步验证）支持
 */
module.exports = {
    version: 7,
    description: '为用户表添加2FA支持所需字段',
    migrate: async (db) => {
        console.log('开始迁移: 为用户表添加2FA字段...');

        // 检查 users 表是否存在 tfa_secret 字段
        const tableInfo = await db.all("PRAGMA table_info(users)");
        const hasTfaSecret = tableInfo.some(col => col.name === 'tfa_secret');
        const hasTfaEnabled = tableInfo.some(col => col.name === 'tfa_enabled');

        if (!hasTfaSecret) {
            await db.exec(`ALTER TABLE users ADD COLUMN tfa_secret TEXT`);
            console.log('迁移完成: users.tfa_secret 字段已添加');
        } else {
            console.log('迁移跳过: users.tfa_secret 字段已存在');
        }

        if (!hasTfaEnabled) {
            await db.exec(`ALTER TABLE users ADD COLUMN tfa_enabled INTEGER DEFAULT 0`);
            console.log('迁移完成: users.tfa_enabled 字段已添加');
        } else {
            console.log('迁移跳过: users.tfa_enabled 字段已存在');
        }
    }
};
