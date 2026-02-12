/**
 * 数据库迁移 - 添加日历和待办功能表
 */

module.exports = {
    version: 2,
    description: '添加待办事项和日历事件表',
    migrate: async (db) => {
        console.log('开始迁移: 添加待办和日历表...');

        // 创建待办事项表
        await db.exec(`CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            completed INTEGER DEFAULT 0,
            priority INTEGER DEFAULT 1,
            dueDate INTEGER,
            noteId TEXT,
            createdAt INTEGER DEFAULT (strftime('%s', 'now')),
            updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
        )`);

        // 创建日历事件表
        await db.exec(`CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            startTime INTEGER NOT NULL,
            endTime INTEGER,
            allDay INTEGER DEFAULT 0,
            color TEXT DEFAULT '#2563eb',
            noteId TEXT,
            createdAt INTEGER DEFAULT (strftime('%s', 'now')),
            updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
        )`);

        // 创建索引优化查询性能
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_username ON todos(username)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_dueDate ON todos(dueDate)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_username ON events(username)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_startTime ON events(startTime)`);

        console.log('迁移完成: 待办和日历表已创建');
    }
};
