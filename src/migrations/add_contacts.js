/**
 * 数据库迁移 - 添加联系人功能表
 */

module.exports = {
    version: 9,
    description: '添加联系人表支持 CardDAV 同步',
    migrate: async (db) => {
        console.log('开始迁移: 添加联系人表...');

        // 创建联系人表
        await db.exec(`CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            uid TEXT UNIQUE,
            fn TEXT,
            n_family TEXT,
            n_given TEXT,
            n_middle TEXT,
            n_prefix TEXT,
            n_suffix TEXT,
            tel TEXT,
            email TEXT,
            adr TEXT,
            org TEXT,
            title TEXT,
            url TEXT,
            photo TEXT,
            note TEXT,
            bday TEXT,
            nickname TEXT,
            vcard TEXT,
            createdAt INTEGER DEFAULT (strftime('%s', 'now')),
            updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
        )`);

        // 创建索引优化查询性能
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_username ON contacts(username)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_uid ON contacts(uid)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_fn ON contacts(fn)`);

        console.log('迁移完成: 联系人表已创建');
    }
};
