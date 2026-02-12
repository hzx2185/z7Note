# macOS 最新版日历应用 CalDAV 配置指南

## 📋 已添加的 macOS 特殊支持

针对最新版 macOS 日历应用的特殊要求，已添加以下功能：

### 1. Principal 路径支持
- `/caldav/principal/:username` - macOS 需要的 principal 路径
- 包含 `current-user-principal` 响应
- 包含 `calendar-home-set` 属性

### 2. 增强的 DAV 响应头
```
DAV: 1, 2, 3, access-control, calendar-access, calendar-proxy, calendar-auto-schedule
Allow: OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, MKCOL
```

### 3. 完整的时区信息
```xml
<C:calendar-timezone>
  BEGIN:VTIMEZONE
  TZID:Asia/Shanghai
  BEGIN:STANDARD
  TZOFFSETFROM:+0900
  TZOFFSETTO:+0800
  DTSTART:19700101T000000
  TZNAME:CST
  END:STANDARD
  END:VTIMEZONE
</C:calendar-timezone>
```

### 4. CalendarServer 扩展
添加了 `http://calendarserver.org/ns/` 命名空间支持

### 5. CTag 支持
```
<C:getctag>"1739212345678"</C:getctag>
```
用于检测日历变更

---

## 🚀 配置步骤

### 步骤 1: 清除现有配置（如果之前配置过）

1. 打开 **系统设置** → **互联网账户**
2. 找到之前的 CalDAV 账户
3. 点击 **删除账户**
4. 确认删除

### 步骤 2: 添加新账户

1. 打开 **日历** 应用
2. 点击菜单栏：**日历** → **账户** (或 `⌘,`)
3. 点击左下角 **+** 按钮
4. 选择 **其他 CalDAV 账户**

### 步骤 3: 填写账户信息

**重要**：确保使用以下确切信息：

```
账户类型: CalDAV
用户名: testuser
密码: 123456
服务器地址: http://localhost:3000/caldav/
```

**注意**：
- 服务器地址末尾有 `/`
- 不要添加额外的路径
- 使用 `http://` 而不是 `https://`（本地测试）

### 步骤 4: 点击创建

macOS 会自动发现服务并配置日历。

---

## 🔍 验证配置

### 检查 1: 日历是否显示

在日历应用左侧边栏，你应该看到：
- **账户名称**：testuser
- **日历名称**：testuser@z7note

### 检查 2: 测试创建事件

1. 选择 **testuser@z7note** 日历
2. 双击任意日期
3. 创建一个测试事件
4. 点击 **添加**

### 检查 3: 查看服务器日志

```bash
docker logs -f z7note | grep -i caldav
```

应该看到类似：
```
[INFO] CalDAV 根路径 PROPFIND { username: 'testuser' }
[INFO] CalDAV 用户日历 PROPFIND { username: 'testuser' }
```

---

## 🧪 诊断工具

### 运行完整测试

```bash
./test-macos-caldav.sh
```

### 手动测试各个端点

#### 1. 测试根路径
```bash
curl -v -X PROPFIND http://localhost:3000/caldav/ \
  -u testuser:123456 \
  -H "Depth: 1" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>'
```

应该返回包含 `/caldav/principal/testuser` 的 XML

#### 2. 测试 Principal 路径
```bash
curl -v -X PROPFIND http://localhost:3000/caldav/principal/testuser \
  -u testuser:123456 \
  -H "Depth: 0" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>'
```

应该返回 principal 信息

#### 3. 测试用户日历
```bash
curl -v -X PROPFIND http://localhost:3000/caldav/testuser \
  -u testuser:123456 \
  -H "Depth: 1" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>'
```

应该返回日历属性和时区信息

#### 4. 获取日历数据
```bash
curl -v http://localhost:3000/caldav/testuser/ \
  -u testuser:123456
```

应该返回 iCalendar 格式数据

---

## 🐛 故障排查

### 问题 1: "无法验证账号名或密码"

**可能原因**：
- 用户不存在
- 密码错误
- Basic Auth 未正确处理

**解决方法**：

1. 检查用户是否存在：
```bash
docker exec -it z7note sqlite3 /app/data/z7note.db "SELECT username FROM users;"
```

2. 如果 testuser 不存在，创建用户：
   - 访问 `http://localhost:3000/login.html`
   - 点击"注册"
   - 创建用户 `testuser` / `123456`

3. 查看服务器日志：
```bash
docker logs z7note | grep -i "basic auth"
```

### 问题 2: "找不到日历" 或 "日历为空"

**可能原因**：
- macOS 没有正确解析 PROPFIND 响应
- 时区信息缺失
- CTag 问题

**解决方法**：

1. 查看完整的 PROPFIND 响应：
```bash
curl -X PROPFIND http://localhost:3000/caldav/ \
  -u testuser:123456 \
  -H "Depth: 1" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/><resourcetype/><current-user-principal/><calendar-home-set/></prop></propfind>' | xmllint --format -
```

2. 删除账户重新添加（见步骤 1）

3. 重启日历应用：
```bash
# 关闭日历应用
killall Calendar

# 重新打开
open -a Calendar
```

### 问题 3: 事件不同步

**可能原因**：
- ETag 问题
- REPORT 请求未实现

**解决方法**：

1. 查看服务器日志中的 REPORT 请求：
```bash
docker logs -f z7note | grep -i report
```

2. 手动触发同步：
   - 日历应用 → **显示** → **刷新 Calendars** (`⌘R`)

### 问题 4: 连接超时

**可能原因**：
- 服务器未运行
- 端口被占用
- 防火墙阻止

**解决方法**：

1. 检查服务器状态：
```bash
docker ps | grep z7note
```

2. 检查端口：
```bash
lsof -i :3000
```

3. 测试连接：
```bash
curl -v http://localhost:3000/health
```

---

## 📊 日志分析

### 常见日志

| 日志 | 含义 | 操作 |
|------|------|------|
| `CalDAV 根路径 PROPFIND` | macOS 发现服务 | 正常 |
| `CalDAV 用户日历 PROPFIND` | macOS 查询日历 | 正常 |
| `Basic Auth 验证成功` | 认证通过 | 正常 |
| `Basic Auth 用户不存在` | 用户不存在 | 创建用户 |
| `Basic Auth 密码错误` | 密码错误 | 检查密码 |

### 查看实时日志

```bash
docker logs -f z7note | grep -E "CalDAV|Basic Auth"
```

---

## 🔧 高级配置

### 配置多个日历

目前 z7Note 每个用户有一个主日历。如需多个日历：

1. 在数据库添加 `calendar_name` 字段
2. 更新 CalDAV 路由支持多日历
3. 路径格式：`/caldav/:username/:calendarname`

### 自定义同步间隔

macOS 默认同步间隔为 15 分钟。可以调整：

1. **系统设置** → **互联网账户**
2. 选择 CalDAV 账户
3. 点击 **账户信息**
4. 选择刷新频率

### HTTPS 配置

如需远程访问：

1. 配置 Nginx 反向代理
2. 使用 Let's Encrypt 证书
3. 在 macOS 中使用 `https://your-domain.com/caldav/`

---

## 📱 其他客户端

### Thunderbird（推荐）

```bash
brew install --cask thunderbird
```

配置：
- 类型：CalDAV
- 位置：`http://localhost:3000/caldav/testuser/`
- 用户名：`testuser`
- 密码：`123456`

### iOS 日历

```
服务器: https://your-domain.com/caldav/
用户名: testuser
密码: 123456
```

---

## 🎯 下一步

配置成功后，你可以：

1. ✅ 在日历中创建和管理事件
2. ✅ 同步到其他 Mac 设备
3. ✅ 使用 z7Note web 界面管理日历
4. ✅ 配置定期备份

---

## 📞 需要帮助？

如果仍然无法配置，请提供：

1. macOS 版本（例如：macOS Sonoma 14.2）
2. 日历应用版本
3. 错误信息截图
4. 服务器日志：
   ```bash
   docker logs z7note > caldav-logs.txt
   ```
5. 配置的 URL

---

## 📚 相关文档

- `QUICK_MACOS_SETUP.md` - 快速配置指南
- `MACOS_CALDAV_SETUP.md` - 完整配置和故障排查
- `CALDAV_WORKING.md` - CalDAV 技术文档
- `test-macos-caldav.sh` - 自动化测试脚本
