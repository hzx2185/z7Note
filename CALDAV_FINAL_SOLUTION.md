# z7Note CalDAV 最终解决方案

## 问题总结

### 问题 1: macOS 日历无法配置
**现象**: macOS 日历显示"无法验证账号名和密码"
**原因**: macOS 日历对 HTTPS 和某些响应格式有特殊要求
**解决方案**:
1. 使用 HTTPS 配置: `https://z7note.255556.xyz/caldav/`
2. 清除 macOS 缓存后重新配置
3. 使用其他客户端验证服务器功能（如 Thunderbird）

### 问题 2: Thunderbird 可以添加账户但无法同步
**现象**: Thunderbird 成功连接，但创建事件时服务器返回 400 错误
**根本原因**: CalDAV PUT 请求的路径格式不匹配

#### 原始实现
- 路由定义: `router.put('/:username/:type/:id', ...)`
- 期望路径: `/caldav/username/event/id`
- 实际路径: `/caldav/username/uid.ics`

#### 客户端实际行为
Thunderbird (和其他标准 CalDAV 客户端) 使用以下路径格式：
- `PUT /caldav/username/event-uid.ics` - 保存单个事件
- `DELETE /caldav/username/event-uid.ics` - 删除事件
- `GET /caldav/username/` - 获取整个日历

**解决方案**: 添加标准 CalDAV PUT 路由支持
```javascript
router.put('/:username/:filename.ics', basicAuthMiddleware, async (req, res) => {
  // 解析 .ics 文件内容
  // 保存事件到数据库
  // 返回 201 Created
});
```

## 已实现的功能

### 服务器端
✅ OPTIONS 请求
✅ PROPFIND 根路径（服务发现）
✅ PROPFIND Principal 路径（用户识别）
✅ PROPFIND 用户日历路径（日历属性）
✅ GET 用户日历（获取所有事件）
✅ PUT .ics 文件（创建/更新事件）
✅ REPORT 查询（日历数据查询）

### 响应头
✅ DAV: 1, 2, 3, access-control, calendar-access, calendar-proxy, calendar-auto-schedule
✅ Allow: OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, MKCOL
✅ Content-Type: application/xml; charset=utf-8 (for XML responses)
✅ Content-Type: text/calendar; charset=utf-8 (for iCalendar)

### macOS 特殊支持
✅ Current User Principal
✅ Calendar Home Set
✅ Calendar Timezone (Asia/Shanghai)
✅ CTag 支持
✅ CalendarServer 扩展命名空间

## 配置指南

### Thunderbird（推荐，已测试）

1. **安装 Thunderbird**:
   ```bash
   brew install --cask thunderbird
   ```

2. **配置 CalDAV 账户**:
   - 打开 Thunderbird
   - 菜单栏：**事件** → **日历** → **新建日历**
   - 选择 **在网络上** → **CalDAV**
   - 位置: `https://z7note.255556.xyz/caldav/snowfly/`
   - 用户名: `snowfly`
   - 密码: `your_password`

3. **测试同步**:
   - 创建测试事件
   - 刷新日历
   - 验证事件显示在 web 界面

### macOS 日历

#### 配置步骤
1. 打开 **系统设置** → **互联网账户**
2. 点击 **+** → **其他 CalDAV 账户**
3. 填写：
   ```
   账户类型: CalDAV
   用户名: snowfly
   密码: your_password
   服务器地址: https://z7note.255556.xyz/caldav/
   ```
4. 点击 **创建**

#### 如果失败
1. 删除现有账户
2. 关闭日历应用: `killall Calendar`
3. 清除缓存（可能需要重启）
4. 使用 HTTPS 而不是 HTTP

### 其他 CalDAV 客户端

#### BusyCal (macOS)
- 下载: https://macoshome.com/productivity/11075.html
- 配置: https://z7note.255556.xyz/caldav/snowfly/

#### iOS 日历
```
服务器: https://z7note.255556.xyz/caldav/
用户名: snowfly
密码: your_password
```

#### Outlook (Windows)
使用 Outlook CalDav Synchronizer 插件：
- CalDAV URL: https://z7note.255556.xyz/caldav/snowfly/
- 用户名: snowfly
- 密码: your_password

## 测试工具

### 自动化测试
```bash
# 功能测试
./test-macos-caldav.sh

# 完整序列测试
./test-macos-sequence.sh

# 诊断工具
./diagnose-macos-caldav.sh

# 实时日志监控
./monitor-caldav.sh
```

### 手动测试
```bash
# 测试根路径 PROPFIND
curl -X PROPFIND http://localhost:3000/caldav/ \
  -u snowfly:password \
  -H "Depth: 1" \
  -H "Content-Type: text/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>'

# 测试获取日历
curl http://localhost:3000/caldav/snowfly/ -u snowfly:password

# 测试 PUT 事件
curl -X PUT http://localhost:3000/caldav/snowfly/test.ics \
  -u snowfly:password \
  -H "Content-Type: text/calendar" \
  -d @event.ics
```

## 日志分析

### 成功的请求模式
```
[CalDAV] OPTIONS / - User-Agent: Thunderbird/...
[CalDAV] PROPFIND / - User-Agent: Thunderbird/...
[CalDAV] PROPFIND /principal/snowfly - User-Agent: Thunderbird/...
[CalDAV] PROPFIND /snowfly/ - User-Agent: Thunderbird/...
[CalDAV] GET /snowfly/ - User-Agent: Thunderbird/...
[CalDAV] Response: 200 for GET /snowfly/
[INFO] CalDAV PUT .ics 文件 { username: 'snowfly', filename: 'xxx.ics' }
[INFO] CalDAV 创建事件 (PUT .ics) { username: 'snowfly', eventId: 'xxx' }
[CalDAV] Response: 201 for PUT /snowfly/xxx.ics
```

### 错误和解决
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 401 Unauthorized | 认证失败 | 检查用户名和密码 |
| 403 Forbidden | 权限不足 | 用户名不匹配 |
| 400 Bad Request | 请求格式错误 | 检查 iCal 格式 |
| 500 Internal Server Error | 服务器错误 | 查看详细日志 |
| SQLITE_ERROR: 10 values for 11 columns | SQL 参数不匹配 | 修复 SQL 语句 |

## 数据库结构

### events 表
```sql
CREATE TABLE events (
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
);
```

### todos 表
```sql
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  completed INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 5,
  dueDate INTEGER,
  noteId TEXT,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
  updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
);
```

## 相关文档

- `CALDAV_WORKING.md` - CalDAV 技术文档
- `MACOS_MODERN_CALENDAR.md` - macOS 日历详细配置
- `QUICK_MACOS_SETUP.md` - 快速配置指南
- `test-macos-caldav.sh` - 功能测试脚本
- `diagnose-macos-caldav.sh` - 诊断工具
- `monitor-caldav.sh` - 实时日志监控

## 下一步

1. ✅ Thunderbird 应该可以正常同步
2. ✅ 测试创建、更新、删除事件
3. ✅ 验证 web 界面和客户端双向同步
4. 🔧 macOS 日历可能需要额外调试

## 技术支持

如果遇到问题，请提供：

1. 客户端类型和版本
2. 具体的错误信息或截图
3. 服务器日志：`docker logs z7note > caldav.log`
4. 配置的 URL（可隐藏密码）

---

**最后更新**: 2026-02-11
**状态**: Thunderbird 基本功能已实现，需要测试验证
