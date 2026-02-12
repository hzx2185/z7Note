# CalDAV 功能说明

## 功能概述

z7Note 现已支持 CalDAV 协议（RFC 4791），可以与各种日历客户端进行双向同步。

## 支持的功能

### ✅ 已实现

1. **事件同步**
   - 读取事件（GET /caldav/:username）
   - 创建事件（PUT /caldav/:username/event/:id）
   - 更新事件（PUT /caldav/:username/event/:id）
   - 删除事件（DELETE /caldav/:username/event/:id）

2. **待办事项同步**
   - 读取待办（GET /caldav/:username）
   - 创建待办（PUT /caldav/:username/todo/:id）
   - 更新待办（PUT /caldav/:username/todo/:id）
   - 删除待办（DELETE /caldav/:username/todo/:id）

3. **CalDAV 协议**
   - PROPFIND（读取资源属性）
   - REPORT（查询日历数据）
   - OPTIONS（CORS 预检）
   - iCal/ICS 格式支持

4. **iCal 特性**
   - 全天事件支持
   - 事件颜色
   - 待办优先级
   - 时区处理（UTC+8）

## 配置

### 环境变量

在 `.env` 文件中添加：

```bash
# CalDAV 配置
CALDAV_ENABLED=true
CALDAV_BASE=/caldav
```

### 默认配置

- **启用状态**: 默认启用
- **基础路径**: `/caldav`
- **认证方式**: Cookie 认证（需要先登录）

## 使用方法

### 1. iOS 日历应用

#### 方法一：使用 HTTPS（推荐）

1. 打开"设置" → "日历" → "账户" → "添加账户" → "其他"
2. 选择"CalDAV 账户"
3. 输入服务器信息：
   - 服务器地址: `https://your-server:3000/caldav` 或 `https://your-domain.com/caldav`
   - 用户名: 您的 z7Note 用户名
   - 密码: 您的 z7Note 密码
4. 点击"下一步"
5. 选择要同步的内容（日历、提醒事项）
6. 点击"保存"

#### 方法二：使用 HTTP（仅限测试）

如果测试时遇到 SSL 问题，可以临时使用 HTTP：

1. 打开"设置" → "日历" → "账户" → "添加账户" → "其他"
2. 选择"CalDAV 账户"
3. 输入服务器信息：
   - 服务器地址: `http://your-server:3000/caldav`
   - 用户名: 您的 z7Note 用户名
   - 密码: 您的 z7Note 密码
4. 点击"下一步"
5. 选择要同步的内容（日历、提醒事项）
6. 点击"保存"

**注意：** HTTP 不安全，仅用于测试，生产环境请使用 HTTPS。

### 2. Android 日历应用

1. 打开日历应用
2. 点击菜单 → "设置" → "添加账户"
3. 选择"CalDAV"
4. 输入服务器信息：
   - 服务器地址: `http://your-server:3000/caldav`
   - 用户名: 您的 z7Note 用户名
   - 密码: 您的 z7Note 密码
5. 点击"连接"

### 3. Thunderbird（桌面）

1. 打开 Thunderbird
2. 点击"事件和任务"
3. 点击"新建日历"
4. 选择"在网络上"
5. 输入服务器地址: `http://your-server:3000/caldav/:username`
6. 点击"查找日历"
7. 点击"订阅"

### 4. Outlook（桌面）

1. 打开 Outlook
2. 点击"文件" → "账户设置" → "添加账户"
3. 选择"手动设置或连接其他服务器类型"
4. 选择"Internet 日历"
5. 输入服务器地址: `http://your-server:3000/caldav/:username`
6. 点击"确定"

### 5. iCal 订阅

如果您只需要单向同步（只读），可以使用 iCal 订阅：

1. 在日历应用中添加订阅日历
2. 输入订阅地址: `http://your-server:3000/caldav/:username`
3. 选择刷新频率

## API 端点

### 获取日历数据（iCal 格式）

```
GET /caldav/:username
```

返回用户的完整日历（事件 + 待办），格式为 iCal (.ics)。

### PROPFIND（读取资源属性）

```
PROPFIND /caldav/:username
Headers:
  Depth: 0 或 1
  Authorization: Cookie 认证
```

返回日历资源的 XML 属性。

### REPORT（查询日历数据）

```
REPORT /caldav/:username
Headers:
  Depth: 1
  Content-Type: application/xml
  Authorization: Cookie 认证
```

查询特定时间范围的日历数据。

### 创建/更新事件

```
PUT /caldav/:username/event/:id
Headers:
  Content-Type: text/calendar
  Authorization: Cookie 认证
Body:
  BEGIN:VCALENDAR
  BEGIN:VEVENT
  ...
  END:VEVENT
  END:VCALENDAR
```

创建或更新指定 ID 的事件。

### 创建/更新待办

```
PUT /caldav/:username/todo/:id
Headers:
  Content-Type: text/calendar
  Authorization: Cookie 认证
Body:
  BEGIN:VCALENDAR
  BEGIN:VTODO
  ...
  END:VTODO
  END:VCALENDAR
```

创建或更新指定 ID 的待办事项。

### 删除事件

```
DELETE /caldav/:username/event/:id
Authorization: Cookie 认证
```

删除指定 ID 的事件。

### 删除待办

```
DELETE /caldav/:username/todo/:id
Authorization: Cookie 认证
```

删除指定 ID 的待办事项。

## iCal 格式说明

### 事件格式

```ical
BEGIN:VEVENT
UID:event123@z7note
DTSTAMP:20260210T080000Z
DTSTART:20260210T090000Z
DTEND:20260210T100000Z
SUMMARY:会议标题
DESCRIPTION:会议描述
ORGANIZER:MAILTO:username@z7note
STATUS:CONFIRMED
TRANSP:OPAQUE
SEQUENCE:0
LAST-MODIFIED:20260210T080000Z
X-APPLE-CALENDAR-COLOR:#2563eb
END:VEVENT
```

### 待办格式

```ical
BEGIN:VTODO
UID:todo456@z7note
DTSTAMP:20260210T080000Z
DUE;VALUE=DATE:20260210
SUMMARY:待办标题
DESCRIPTION:待办描述
PRIORITY:5
STATUS:NEEDS-ACTION
PERCENT-COMPLETE:0
SEQUENCE:0
LAST-MODIFIED:20260210T080000Z
END:VTODO
```

## 优先级映射

### z7Note → iCal

| z7Note | iCal |
|---------|------|
| 1 (低)  | 9    |
| 2 (中)  | 5    |
| 3 (高)  | 1    |

### iCal → z7Note

| iCal | z7Note |
|------|---------|
| 1-4  | 3 (高)  |
| 5-8  | 2 (中)  |
| 9    | 1 (低)  |

## 时区处理

- 所有日期时间以 UTC 格式存储和传输
- 显示时自动转换为本地时区（UTC+8）
- 全天事件使用 `VALUE=DATE` 格式

## 注意事项

1. **认证**: CalDAV 端点使用 Basic Auth 认证（用户名:密码）
2. **ID**: 事件和待办的 ID 由客户端生成，格式建议为 `uuid@z7note`
3. **时区**: 请确保客户端使用 UTC 时区
4. **兼容性**: 已测试 iOS 日历和 Android 日历
5. **同步**: 同步频率由客户端控制

## 故障排除

### iOS 日历无法连接

1. 检查服务器地址是否正确
2. 确认用户名和密码正确
3. 检查网络连接
4. 尝试使用 HTTPS（如果配置了 SSL）

### iOS SSL 证书错误

如果 iPhone 提示"无法验证 SSL 证书"或"无法配置 SSL"：

#### 检查 SSL 证书

1. **使用 curl 测试**：
   ```bash
   curl -v https://your-server.com/caldav/
   ```
   查看是否显示 `SSL certificate verify ok`

2. **检查证书链**：
   ```bash
   openssl s_client -connect your-server.com:443 -servername your-server.com
   ```
   确保证书链完整，包含中间证书

3. **检查证书有效期**：
   - 确保证书未过期
   - 确保证书未使用自签名证书

#### 解决方案

**方案 1：修复 SSL 证书配置（推荐）**

如果使用 Let's Encrypt 证书：

```bash
# 检查证书
certbot certificates

# 重新获取证书
certbot certonly --webroot -w /var/www/html -d your-domain.com

# 重启 nginx
systemctl restart nginx
```

**方案 2：临时使用 HTTP（仅测试）**

如果只是测试，可以临时使用 HTTP：

- 服务器地址: `http://your-server:3000/caldav`
- 注意：HTTP 不安全，仅用于测试

**方案 3：信任自签名证书（不推荐）**

如果使用自签名证书，需要在 iPhone 上手动信任：

1. 在 Safari 中访问 `https://your-server.com`
2. 点击证书详情
3. 安装证书
4. 进入"设置" → "已下载的描述文件"
5. 安装证书
6. 进入"设置" → "通用" → "关于本机" → "证书信任设置"
7. 启用该证书的完全信任

**方案 4：检查 nginx 配置**

确保 nginx 配置包含完整的证书链：

```nginx
ssl_certificate /path/to/fullchain.pem;  # 包含证书和中间证书
ssl_certificate_key /path/to/privkey.pem;
```

不要只使用 `cert.pem`，应该使用 `fullchain.pem`。

#### 验证修复

修复后，运行测试脚本：

```bash
./test-iphone-caldav.sh
```

或手动测试：

```bash
# 测试 OPTIONS 请求
curl -v -X OPTIONS https://your-server.com/caldav/

# 测试 PROPFIND 请求
curl -v -X PROPFIND https://your-server.com/caldav/username \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  -H "Depth: 0"
```

### Android 日历无法同步

1. 检查服务器地址是否正确
2. 确认用户名和密码正确
3. 检查 Android 日历应用的权限
4. 尝试手动刷新同步

### 同步失败

1. 查看服务器日志: `docker-compose logs -f`
2. 检查 CalDAV 是否启用: `CALDAV_ENABLED=true`
3. 确认用户有权限访问日历数据

### 常见错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| 401 | 认证失败 | 检查用户名和密码 |
| 403 | 权限不足 | 确认用户名正确 |
| 404 | 路由不存在 | 检查服务器地址 |
| 500 | 服务器错误 | 查看服务器日志 |
| 502 | 网关错误 | 检查 nginx 配置 |
| 503 | 服务不可用 | 重启服务 |

### 调试技巧

启用详细日志：

```bash
# 查看 CalDAV 相关日志
docker-compose logs -f | grep -i caldav

# 查看所有日志
docker-compose logs -f
```

测试 CalDAV 端点：

```bash
# 测试 OPTIONS
curl -I -X OPTIONS https://your-server.com/caldav/

# 测试 PROPFIND
curl -I -X PROPFIND https://your-server.com/caldav/username \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  -H "Depth: 0"

# 测试 GET
curl -I https://your-server.com/caldav/username \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)"
```

## 技术细节

### 数据存储

- 事件存储在 `events` 表
- 待办存储在 `todos` 表
- 时间戳使用 Unix 时间戳（秒）
- 笔记的 `updatedAt` 使用毫秒时间戳

### 协议支持

- WebDAV Level 1, 2, 3
- CalDAV Extensions (calendar-access, calendar-query, etc.)
- iCalendar (RFC 5545)
- iCalendar Transport-Independent Interoperability (RFC 5546)

### 安全

- 需要用户认证
- 仅访问用户自己的数据
- 支持跨域请求（CORS）

## 更新日志

### v1.0.0 (2026-02-10)

- ✅ 初始版本
- ✅ 支持事件和待办的 CRUD 操作
- ✅ 支持 PROPFIND 和 REPORT
- ✅ 支持 iCal 格式
- ✅ 支持多客户端同步

## 反馈与支持

如有问题或建议，请提交 Issue 或联系开发者。
