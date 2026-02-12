# z7Note CalDAV 工作配置

## 服务器状态

✅ 服务器已成功启动
✅ CalDAV 功能正常工作
✅ Basic Auth 认证正常

## 测试结果

### 1. OPTIONS 请求
```
HTTP/1.1 200 OK
Allow: OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR
DAV: 1, 2, 3, calendar-access, calendar-auto-schedule, calendar-query, calendar-multiget, calendar-availability, calendar-proxy
```

### 2. PROPFIND 请求
```
HTTP/1.1 207 Multi-Status
Content-Type: application/xml; charset=utf-8
```

返回内容：
- Calendar 名称: testuser
- 资源类型: collection/calendar
- 支持的组件: VEVENT (事件), VTODO (待办)

### 3. GET 请求
```
HTTP/1.1 200 OK
Content-Type: text/calendar; charset=utf-8
Content-Disposition: attachment; filename="testuser.ics"
```

返回完整的 iCalendar 格式数据

## 客户端配置

### iPhone 日历 (iOS)

**重要提示**: iOS 需要使用 HTTPS，但可以忽略 SSL 证书警告

#### 配置步骤：

1. 打开 **设置** → **日历** → **账户** → **添加账户** → **其他** → **添加 CalDAV 账户**

2. **服务器配置**：
   - **服务器**: `https://your-domain.com` (替换为你的域名)
   - **用户名**: `testuser`
   - **密码**: `123456`
   - **描述**: `z7Note Calendar`

3. **高级设置**（如果需要）：
   - **端口**: `443`
   - **SSL**: 使用 SSL
   - **账户 URL**: `https://your-domain.com/caldav/testuser/`

4. **处理 SSL 警告**：
   - 如果提示"无法验证服务器身份"，点击**继续**
   - 如果提示"你要设置没有SSL的账户吗?"，选择**继续**

#### 本地网络 HTTP 配置：

如果 iPhone 和服务器在同一局域网：

- **服务器**: `http://192.168.x.x:3000` (替换为你的内网IP)
- **用户名**: `testuser`
- **密码**: `123456`
- **账户 URL**: `http://192.168.x.x:3000/caldav/testuser/`

### macOS 日历应用

#### 配置步骤：

1. 打开 **日历** 应用
2. **日历** → **账户** → **添加账户** → **其他 CalDAV 账户**

3. **账户信息**：
   - **账户类型**: CalDAV
   - **用户名**: `testuser`
   - **密码**: `123456`
   - **服务器地址**: `https://your-domain.com/caldav/`

4. 点击**创建**，系统会自动检测日历服务

### 其他 CalDAV 客户端

#### Thunderbird (Windows/Linux)

1. 安装 Lightning 插件
2. **事件** → **日历** → **新建日历** → **在网络上** → **CalDAV**
3. 位置: `https://your-domain.com/caldav/testuser/`
4. 用户名: `testuser`
5. 密码: `123456`

#### Outlook (Windows)

使用 Outlook CalDav Synchronizer 插件：
- CalDAV URL: `https://your-domain.com/caldav/testuser/`
- 用户名: `testuser`
- 密码: `123456`

## 故障排查

### 问题 1: "无法验证账号和密码"

**可能原因**：
- 用户名或密码错误
- 用户不存在于数据库中

**解决方法**：
```bash
# 检查数据库中的用户
docker exec -it z7note sqlite3 /app/data/z7note.db "SELECT username FROM users;"

# 如果 testuser 不存在，需要通过 web 界面注册
# 访问: http://your-domain.com:3000/login.html
# 点击注册，创建新用户
```

### 问题 2: "无法使用SSL连接"

**iOS 特性问题**: iOS 对 SSL 证书要求严格

**解决方案 A** - 使用自签名证书的域名：
1. 确保 HTTPS 配置正确
2. 在 iOS 设备上访问一次 `https://your-domain.com`
3. 点击"继续"忽略证书警告
4. 然后再配置 CalDAV

**解决方案 B** - 使用 HTTP（仅限局域网）：
```
服务器: http://192.168.x.x:3000
账户 URL: http://192.168.x.x:3000/caldav/testuser/
```

### 问题 3: 连接超时

**检查网络连接**：
```bash
# 从服务器测试
curl -v http://localhost:3000/caldav/testuser/ -u testuser:123456

# 从局域网测试（替换 IP）
curl -v http://192.168.x.x:3000/caldav/testuser/ -u testuser:123456
```

**检查防火墙**：
```bash
# 确保 3000 端口开放
sudo iptables -L | grep 3000
```

### 问题 4: 日历同步不更新

**强制同步**：
- iOS: 日历应用 → 下拉刷新
- macOS: 日历应用 → View → Refresh Calendars

**检查服务器日志**：
```bash
docker-compose logs -f z7note | grep -i caldav
```

## API 端点

### CalDAV 端点

- `OPTIONS /caldav/:username/` - 获取支持的方法
- `PROPFIND /caldav/:username/` - 获取日历属性
- `GET /caldav/:username/` - 获取 iCalendar 数据
- `PUT /caldav/:username/` - 创建/更新事件
- `DELETE /caldav/:username/:uid` - 删除事件
- `REPORT /caldav/:username/` - 日历查询

### 认证方式

使用 HTTP Basic Auth：
```
Authorization: Basic base64(username:password)
```

## 数据格式

### iCalendar (ICS) 格式

事件示例：
```ics
BEGIN:VEVENT
UID:event-123
DTSTART:20240211T090000Z
DTEND:20240211T100000Z
SUMMARY:会议
DESCRIPTION:项目讨论会
LOCATION:会议室A
STATUS:CONFIRMED
END:VEVENT
```

待办示例：
```ics
BEGIN:VTODO
UID:todo-456
DTSTART:20240211T090000Z
DUE:20240211T170000Z
SUMMARY:完成报告
PRIORITY:5
STATUS:NEEDS-ACTION
END:VTODO
```

## 支持的功能

✅ 日历事件 (VEVENT)
✅ 待办事项 (VTODO)
✅ 重复事件
✅ 提醒
✅ 多日历支持
✅ 增量同步 (ETag)
✅ 基础认证
✅ CORS 支持

## 下一步

1. **生产环境**: 配置正式的 SSL 证书（Let's Encrypt）
2. **性能优化**: 添加缓存和 CDN
3. **备份**: 定期备份日历数据
4. **监控**: 设置 CalDAV 访问日志和错误监控

## 技术支持

如果遇到问题，请提供以下信息：
1. 客户端类型和版本
2. 错误信息截图
3. 服务器日志: `docker-compose logs z7note`
4. 配置的 URL 和认证信息（可隐藏密码）
