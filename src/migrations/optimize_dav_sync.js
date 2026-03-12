/**
 * 数据库迁移 - 优化 CalDAV/CardDAV 同步性能
 */

module.exports = {
    version: 13,
    description: '为 events, todos 和 notes 表添加 username 和 updatedAt 复合索引',
    migrate: async (db) => {
        console.log('开始迁移: 优化同步性能索引...');

        // 为 events 表添加复合索引
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_user_updated ON events(username, updatedAt)`);
        
        // 为 todos 表添加复合索引
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_user_updated ON todos(username, updatedAt)`);

        // notes 表通常已经有了 idx_notes_username_updated，但为了稳妥重新确保
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_username_updated ON notes(username, updatedAt)`);

        console.log('迁移完成: 同步优化索引已创建');
    }
};
