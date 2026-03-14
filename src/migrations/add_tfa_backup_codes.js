
/**
 * 数据库迁移 - 添加2FA备用代码支持
 */
module.exports = {
    version: 8,
    description: '为用户表添加2FA备用代码所需字段',
    migrate: async (db) => {
        console.log('开始迁移: 为用户表添加2FA备用代码字段...');

        const hasTfaBackupCodes = await db.schema.hasColumn('users', 'tfa_backup_codes');

        if (!hasTfaBackupCodes) {
            await db.exec(`ALTER TABLE users ADD COLUMN tfa_backup_codes TEXT`);
            console.log('迁移完成: users.tfa_backup_codes 字段已添加');
        } else {
            console.log('迁移跳过: users.tfa_backup_codes 字段已存在');
        }
    }
};
