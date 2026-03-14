/**
 * 数据库迁移 - 添加提醒功能
 */
const { SQLITE_DEFAULTS } = require('../db/schema/sqlite-defaults');

module.exports = {
    version: 5,
    description: '添加提醒功能表和字段',
    migrate: async (db) => {
        console.log('开始迁移: 添加提醒功能...');

        // 创建提醒设置表
        await db.exec(`CREATE TABLE IF NOT EXISTS reminder_settings (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            event_reminder_enabled INTEGER DEFAULT 1,
            todo_reminder_enabled INTEGER DEFAULT 1,
            reminder_advance_days INTEGER DEFAULT 1,
            reminder_advance_hours INTEGER DEFAULT 0,
            reminder_advance_minutes INTEGER DEFAULT 0,
            notification_methods TEXT DEFAULT 'email,browser',
            email_reminder_enabled INTEGER DEFAULT 1,
            browser_reminder_enabled INTEGER DEFAULT 1,
            caldav_reminder_enabled INTEGER DEFAULT 0,
            quiet_start_time TEXT DEFAULT '22:00',
            quiet_end_time TEXT DEFAULT '08:00',
            createdAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds},
            updatedAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds}
        )`);

        // 创建提醒历史表
        await db.exec(`CREATE TABLE IF NOT EXISTS reminder_history (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            type TEXT NOT NULL,  -- 'event' or 'todo'
            target_id TEXT NOT NULL,  -- event.id or todo.id
            reminder_time INTEGER NOT NULL,
            method TEXT NOT NULL,  -- 'email', 'browser', 'caldav'
            status TEXT DEFAULT 'pending',  -- 'pending', 'sent', 'failed'
            error_message TEXT,
            sent_at INTEGER,
            createdAt INTEGER DEFAULT ${SQLITE_DEFAULTS.epochSeconds}
        )`);

        // 为events表添加提醒相关字段
        const hasReminderEmail = await db.schema.hasColumn('events', 'reminderEmail');
        const hasReminderBrowser = await db.schema.hasColumn('events', 'reminderBrowser');
        const hasReminderCaldav = await db.schema.hasColumn('events', 'reminderCaldav');

        if (!hasReminderEmail) {
            await db.exec(`ALTER TABLE events ADD COLUMN reminderEmail INTEGER DEFAULT 0`);
        }
        if (!hasReminderBrowser) {
            await db.exec(`ALTER TABLE events ADD COLUMN reminderBrowser INTEGER DEFAULT 1`);
        }
        if (!hasReminderCaldav) {
            await db.exec(`ALTER TABLE events ADD COLUMN reminderCaldav INTEGER DEFAULT 0`);
        }

        // 为todos表添加提醒相关字段
        const hasTodoReminderEmail = await db.schema.hasColumn('todos', 'reminderEmail');
        const hasTodoReminderBrowser = await db.schema.hasColumn('todos', 'reminderBrowser');

        if (!hasTodoReminderEmail) {
            await db.exec(`ALTER TABLE todos ADD COLUMN reminderEmail INTEGER DEFAULT 0`);
        }
        if (!hasTodoReminderBrowser) {
            await db.exec(`ALTER TABLE todos ADD COLUMN reminderBrowser INTEGER DEFAULT 1`);
        }

        // 创建索引优化查询性能
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_reminder_settings_username ON reminder_settings(username)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_reminder_history_username ON reminder_history(username)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_reminder_history_status ON reminder_history(status)`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_reminder_history_reminder_time ON reminder_history(reminder_time)`);

        console.log('迁移完成: 提醒功能已添加');
    }
};
