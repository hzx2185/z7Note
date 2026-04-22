/**
 * 添加待办完成设置字段
 */

module.exports = {
  version: 19,
  description: '为提醒设置表添加待办完成相关字段',
  async migrate(db) {
    db.log('开始迁移: 为 reminder_settings 增加 todo_complete_to_event 和 delete_todo_after_convert 字段...');

    try {
      if (!(await db.schema.hasColumn('reminder_settings', 'todo_complete_to_event'))) {
        await db.exec('ALTER TABLE reminder_settings ADD COLUMN todo_complete_to_event INTEGER DEFAULT 0');
        db.log('已添加 todo_complete_to_event 字段');
      }

      if (!(await db.schema.hasColumn('reminder_settings', 'delete_todo_after_convert'))) {
        await db.exec('ALTER TABLE reminder_settings ADD COLUMN delete_todo_after_convert INTEGER DEFAULT 1');
        db.log('已添加 delete_todo_after_convert 字段');
      }

      db.log('迁移完成: todo_complete_settings');
    } catch (e) {
      db.error('迁移失败', { error: e.message });
      throw e;
    }
  }
};
