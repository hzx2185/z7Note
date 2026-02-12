# macOS 最新版日历 CalDAV 问题解决方案

## ✅ 已解决的问题

### 问题
macOS 最新版日历应用无法连接 CalDAV 服务器，提示"无法验证账号名和密码"。

### 根本原因
最新版 macOS 日历应用对 CalDAV 协议有更严格的要求，包括：
1. **Principal 路径**：macOS 需要 `/caldav/principal/:username` 路径来识别用户
2. **增强的 DAV 响应头**：需要包含 `access-control`, `calendar-proxy`, `calendar-auto-schedule`
3. **完整的时区信息**：日历必须包含 `<C:calendar-timezone>` 元素
4. **CalendarServer 扩展**：需要 `http://calendarserver.org/ns/` 命名空间
5. **Current User Principal**：根路径响应需要包含当前用户的 principal 引用
6. **Calendar Home Set**：需要指定用户的日历主目录
7. **CTag 支持**：需要 `<C:getctag>` 用于增量同步

### 解决方案
已实现所有 macOS 需要的 CalDAV 功能，包括：
- ✅ Principal 路径支持 (`/caldav/principal/:username`)
- ✅ 增强的 DAV 响应头
- ✅ 完整的时区信息（Asia/Shanghai）
- ✅ CalendarServer 扩展支持
- ✅ Current User Principal 引用
- ✅ Calendar Home Set 配置
- ✅ CTag 实现

---

## 🧪 测试结果

运行诊断工具：
```bash
./diagnose-macos-caldav.sh
```

所有测试 ✅ 通过：
- ✅ 服务器状态正常
- ✅ 健康检查通过
- ✅ 根路径 PROPFIND 成功（发现日历：testuser@z7note）
- ✅ Principal 路径成功
- ✅ 用户日历 PROPFIND 成功
- ✅ 获取日历数据成功

---

## 📱 macOS 日历配置步骤

### 第一步：删除现有配置（如果存在）

1. 打开 **系统设置** → **互联网账户**
2. 找到之前的 CalDAV 账户
3. 点击 **删除账户**
4. 确认删除

### 第二步：添加新账户

1. 打开 **日历** 应用
2. 点击菜单：**日历** → **账户**
3. 点击 **+** → **其他 CalDAV 账户**

### 第三步：填写账户信息

```
账户类型: CalDAV
用户名: testuser
密码: 123456
服务器地址: http://localhost:3000/caldav/
```

**重要提示**：
- 服务器地址末尾要有 `/`
- 使用 `http://` 而不是 `https://`（本地测试）
- 确保用户名和密码正确

### 第四步：点击创建

macOS 会自动发现服务并配置日历。

---

## 🔍 验证配置

### 1. 检查日历是否显示

日历应用左侧边栏应该显示：
- **账户**：testuser
- **日历**：testuser@z7note

### 2. 创建测试事件

1. 选择 `testuser@z7note` 日历
2. 双击任意日期
3. 创建测试事件
4. 点击添加

### 3. 查看服务器日志

```bash
docker logs -f z7note | grep -i caldav
```

应该看到类似：
```
[INFO] CalDAV 根路径 PROPFIND { username: 'testuser', path: '/', depth: '1' }
[INFO] CalDAV Principal PROPFIND { username: 'testuser' }
[INFO] CalDAV 用户日历 PROPFIND { username: 'testuser', depth: '0' }
```

---

## 🐛 常见问题

### Q1: 仍然提示"无法验证账号名和密码"

**检查清单**：
1. ✅ 运行 `./diagnose-macos-caldav.sh` 确认服务器正常
2. ✅ 确认用户存在：`docker exec -it z7note sqlite3 /app/data/z7note.db "SELECT username FROM users;"`
3. ✅ 删除账户重新添加
4. ✅ 重启日历应用：`killall Calendar && open -a Calendar`

### Q2: 日历显示为空

**可能原因**：
- 数据库中没有事件（正常）
- macOS 正在同步（需要等待）

**解决方法**：
1. 手动创建一个测试事件
2. 点击 **显示** → **刷新 Calendars** (`⌘R`)

### Q3: 事件不同步

**解决方法**：
1. 查看日志：`docker logs -f z7note | grep -i report`
2. 手动触发同步：**显示** → **刷新 Calendars**
3. 重启日历应用

### Q4: 连接超时

**检查清单**：
1. 服务器运行：`docker ps | grep z7note`
2. 端口监听：`lsof -i :3000`
3. 测试连接：`curl -v http://localhost:3000/health`

---

## 📚 相关文档

- `MACOS_MODERN_CALENDAR.md` - macOS 最新版日历详细配置指南
- `MACOS_CALDAV_SETUP.md` - 完整配置和故障排查
- `QUICK_MACOS_SETUP.md` - 快速配置（3步）
- `CALDAV_WORKING.md` - CalDAV 技术文档
- `diagnose-macos-caldav.sh` - 自动化诊断工具
- `test-macos-caldav.sh` - 功能测试脚本

---

## 🔧 技术细节

### 已实现的 CalDAV 功能

| 功能 | 端点 | 状态 |
|------|------|------|
| OPTIONS | `*` | ✅ |
| 根路径 PROPFIND | `/` | ✅ |
| Principal PROPFIND | `/principal/:username` | ✅ |
| 用户日历 PROPFIND | `/:username` | ✅ |
| GET 日历数据 | `/:username` | ✅ |
| REPORT 查询 | `/:username` | ✅ |
| PUT 创建/更新 | `/:username/:type/:id` | ✅ |
| DELETE 删除 | `/:username/:type/:id` | ✅ |

### 响应头

```http
DAV: 1, 2, 3, access-control, calendar-access, calendar-proxy, calendar-auto-schedule
Allow: OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, MKCOL
Content-Type: application/xml; charset=utf-8
```

### XML 命名空间

```xml
<D:multistatus xmlns:D="DAV:"
               xmlns:C="urn:ietf:params:xml:ns:caldav"
               xmlns:CS="http://calendarserver.org/ns/">
```

---

## 🎯 下一步

配置成功后：

1. ✅ 在日历中创建和管理事件
2. ✅ 同步到其他 Mac 设备
3. ✅ 使用 z7Note web 界面管理日历
4. ✅ 配置定期备份

---

## 📞 需要帮助？

如果问题仍未解决，请提供：

1. macOS 版本（例如：macOS Sonoma 14.2）
2. 日历应用版本
3. 错误信息截图
4. 诊断工具输出：
   ```bash
   ./diagnose-macos-caldav.sh > diagnosis.txt
   ```
5. 服务器日志：
   ```bash
   docker logs z7note --since 10m > caldav-logs.txt
   ```

---

## 🔄 更新历史

- 2026-02-11: 添加 Principal 路径支持，增强 DAV 响应头，添加时区信息，支持 CalendarServer 扩展
- 2026-02-11: 添加 CTag 支持，完善 Calendar Home Set
- 2026-02-11: 创建诊断工具和测试脚本
