# z7Note 日历提醒功能实现文档

## 功能概述

本次实现为 z7Note 项目添加了完整的日历提醒功能，包括：

1. **邮件提醒** - 通过SMTP发送邮件通知
2. **浏览器通知** - 通过WebSocket实时推送浏览器通知
3. **日历应用同步提醒** - 通过CalDAV VALARM支持其他日历应用
4. **增强的ICS导入导出** - 支持Google Calendar、Outlook等主流格式

## 已实现的文件

### 1. 数据库迁移
- `/src/migrations/add_reminders.js` - 提醒功能数据库表结构

### 2. 后端服务
- `/src/services/reminderService.js` - 提醒服务核心逻辑
- `/src/services/mailer.js` - 邮件发送服务（已存在）

### 3. 后端路由
- `/src/routes/reminders.js` - 提醒设置API路由
- `/src/routes/events.js` - 增强的事件API（支持提醒设置）
- `/src/routes/ws.js` - WebSocket广播（已存在）

### 4. 工具模块
- `/src/utils/icsExport.js` - 增强的ICS导入导出工具

### 5. 服务器配置
- `/src/server.js` - 更新的服务器配置（添加提醒定时任务）

### 6. 前端界面
- `/public/reminder-settings.html` - 提醒设置页面
- `/public/js/reminder-settings.js` - 提醒设置页面逻辑

## 数据库表结构

### reminder_settings (提醒设置表)
```sql
CREATE TABLE reminder_settings (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  event_reminder_enabled INTEGER DEFAULT 1,
  todo_reminder_enabled INTEGER DEFAULT 1,
  reminder_advance_days INTEGER DEFAULT 0,
  reminder_advance_hours INTEGER DEFAULT 1,
  reminder_advance_minutes INTEGER DEFAULT 0,
  notification_methods TEXT DEFAULT 'email,browser',
  email_reminder_enabled INTEGER DEFAULT 1,
  browser_reminder_enabled INTEGER DEFAULT 1,
  caldav_reminder_enabled INTEGER DEFAULT 0,
  quiet_start_time TEXT DEFAULT '22:00',
  quiet_end_time TEXT DEFAULT '08:00',
  createdAt INTEGER,
  updatedAt INTEGER
)
```

### reminder_history (提醒历史表)
```sql
CREATE TABLE reminder_history (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'event' or 'todo'
  target_id TEXT NOT NULL,
  reminder_time INTEGER NOT NULL,
  method TEXT NOT NULL,  -- 'email', 'browser', 'caldav'
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  sent_at INTEGER,
  createdAt INTEGER
)
```

### events表新增字段
```sql
ALTER TABLE events ADD COLUMN reminderEmail INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN reminderBrowser INTEGER DEFAULT 1;
ALTER TABLE events ADD COLUMN reminderCaldav INTEGER DEFAULT 0;
```

### todos表新增字段
```sql
ALTER TABLE todos ADD COLUMN reminderEmail INTEGER DEFAULT 0;
ALTER TABLE todos ADD COLUMN reminderBrowser INTEGER DEFAULT 1;
```

## API接口

### 提醒设置API (`/api/reminders`)

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/reminders` | 获取用户提醒设置 |
| PUT | `/api/reminders` | 更新用户提醒设置 |
| POST | `/api/reminders/check` | 手动触发提醒检查 |
| GET | `/api/reminders/history` | 获取提醒历史 |
| DELETE | `/api/reminders/history` | 清除提醒历史 |

### 事件API增强 (`/api/events`)

| 方法 | 路径 | 参数 | 功能 |
|------|------|------|------|
| GET | `/api/events/export` | `targetApp`, `includeReminders` | 导出日历（支持Google/Outlook） |
| POST | `/api/events/import` | `icsContent`, `sourceApp` | 导入日历（自动检测来源） |
| POST | `/api/events` | 支持`reminderEmail`, `reminderBrowser`, `reminderCaldav` | 创建事件 |
| PUT | `/api/events/:id` | 支持`reminderEmail`, `reminderBrowser`, `reminderCaldav` | 更新事件 |

## 功能特性

### 1. 邮件提醒
- 使用现有SMTP配置发送邮件
- 支持HTML格式邮件
- 包含事件详情和跳转链接
- 记录发送历史和失败原因

### 2. 浏览器通知
- 通过WebSocket实时推送
- 支持浏览器原生通知API
- 自动请求通知权限
- 显示事件标题、时间和描述

### 3. 日历应用同步提醒
- 支持CalDAV VALARM组件
- 兼容Google Calendar、Outlook等应用
- 在ICS导出时包含提醒设置

### 4. 免打扰模式
- 可设置免打扰时间段
- 在指定时间段内不发送提醒
- 默认22:00-08:00

### 5. 提醒时间配置
- 支持提前天、小时、分钟设置
- 灵活配置提醒时机
- 默认提前1小时

### 6. ICS导入导出增强
- **Google Calendar支持**：
  - 颜色映射
  - 提醒格式兼容
  - 特定属性处理

- **Outlook支持**：
  - 颜色映射
  - 忙碌状态标记
  - 可见性设置

- **自动检测来源**：
  - 自动识别ICS文件来源
  - 智能调整属性
  - 兼容性优化

### 7. 提醒历史
- 记录所有提醒发送历史
- 显示发送状态和错误信息
- 支持清除历史记录
- 方便排查问题

## 定时任务

系统每分钟自动检查一次待发送的提醒：

```javascript
nodeCron.schedule('* * * * *', async () => {
  try {
    await checkAndSendPendingReminders();
  } catch (e) {
    console.error('[定时任务] 提醒检查失败:', e);
  }
});
```

检查逻辑：
1. 获取所有启用了提醒的用户
2. 检查是否在免打扰时间段
3. 查询即将到期的事件和待办事项
4. 根据用户设置发送提醒
5. 记录发送历史

## 使用说明

### 1. 配置SMTP邮件服务

在`.env`文件中配置SMTP：

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_password_or_app_password
```

### 2. 运行数据库迁移

系统启动时会自动运行迁移，创建必要的表和字段。

### 3. 访问提醒设置

访问 `http://localhost:3000/reminder-settings.html` 配置提醒设置。

### 4. 测试提醒功能

1. 创建一个即将到期的事件（在1小时内）
2. 在事件设置中启用提醒
3. 等待定时任务检查（最多1分钟）
4. 查看邮件、浏览器通知或提醒历史

### 5. 导入导出日历

**导出**：
```javascript
// 标准格式
GET /api/events/export

// Google Calendar格式
GET /api/events/export?targetApp=google

// Outlook格式
GET /api/events/export?targetApp=outlook
```

**导入**：
```javascript
// 自动检测来源
POST /api/events/import
{
  "icsContent": "...",
  "sourceApp": "auto" // 可选：google, outlook, standard
}
```

## 配置选项

### 提醒设置参数
- `event_reminder_enabled`: 是否启用事件提醒
- `todo_reminder_enabled`: 是否启用待办事项提醒
- `reminder_advance_days`: 提前天数（0-30，默认1天）
- `reminder_advance_hours`: 提前小时数（0-23）
- `reminder_advance_minutes`: 提前分钟数（0-59）
- `email_reminder_enabled`: 是否启用邮件提醒（默认启用）
- `browser_reminder_enabled`: 是否启用浏览器通知（默认启用）
- `caldav_reminder_enabled`: 是否启用日历应用提醒
- `quiet_start_time`: 免打扰开始时间（HH:MM）
- `quiet_end_time`: 免打扰结束时间（HH:MM）

### 事件提醒参数
- `reminderEmail`: 是否发送邮件提醒
- `reminderBrowser`: 是否发送浏览器通知
- `reminderCaldav`: 是否同步到日历应用

## 注意事项

1. **SMTP配置**：确保SMTP服务器配置正确，否则邮件提醒无法发送
2. **浏览器通知权限**：用户需要授权浏览器通知权限
3. **免打扰时间**：在免打扰时间段内不会发送任何提醒
4. **定时任务频率**：默认每分钟检查一次，可根据需求调整
5. **提醒历史**：建议定期清理提醒历史，避免表过大

## 扩展建议

### 短期扩展
1. 添加短信提醒（集成短信服务）
2. 添加微信/钉钉机器人提醒
3. 添加提醒声音和震动
4. 添加提醒重复选项（多次提醒）

### 长期扩展
1. 添加智能提醒（基于用户习惯）
2. 添加提醒模板和预设
3. 添加提醒统计和分析
4. 添加团队协作提醒
5. 添加提醒优先级和分类

## 故障排查

### 邮件提醒未收到
1. 检查SMTP配置是否正确
2. 检查邮箱地址是否有效
3. 查看提醒历史中的错误信息
4. 检查邮件是否被标记为垃圾邮件

### 浏览器通知未显示
1. 检查浏览器通知权限
2. 检查WebSocket连接是否正常
3. 检查是否在免打扰时间段
4. 尝试刷新页面重新连接

### CalDAV提醒未同步
1. 检查CalDAV客户端是否支持VALARM
2. 检查导出的ICS文件是否包含VALARM组件
3. 检查日历应用是否正确解析ICS文件

## 技术栈

- **后端**: Node.js + Express
- **数据库**: SQLite3
- **邮件**: Nodemailer
- **实时通信**: WebSocket (ws)
- **定时任务**: node-cron
- **日历格式**: ICS/iCalendar
- **农历**: lunar-javascript

## 许可证

本功能实现遵循 z7Note 项目的开源许可证。
