# macOS 日历应用 CalDAV 配置指南

## ✅ 已修复

已添加根路径 `/` 的 PROPFIND 支持，macOS 日历现在可以正常发现和使用 CalDAV 服务。

## 配置步骤

### 方法一：自动发现（推荐）

1. **打开日历应用**
   - 在你的 Mac 上打开"日历"应用

2. **添加账户**
   - 点击菜单栏：**日历** → **账户** (或使用快捷键 `⌘,` 然后点击"账户")
   - 点击左下角的 **+** 按钮
   - 选择 **其他 CalDAV 账户**

3. **填写账户信息**
   ```
   账户类型: CalDAV
   用户名: testuser
   密码: 123456
   服务器地址: http://localhost:3000/caldav/
   ```

4. **点击创建**
   - macOS 会自动发现日历服务
   - 应该能看到日历 "testuser@z7note"

5. **验证配置**
   - 日历应用左侧边栏应该显示新账户
   - 尝试创建一个测试事件

### 方法二：手动配置 URL

如果自动发现失败，尝试手动指定日历 URL：

1. 按照上面的步骤 1-2 操作

2. 填写账户信息：
   ```
   账户类型: CalDAV
   用户名: testuser
   密码: 123456
   服务器地址: http://localhost:3000/caldav/testuser
   ```

3. 点击创建

## 故障排查

### 问题 1: "无法验证账号名或密码"

**检查用户是否存在：**
```bash
docker exec -it z7note sqlite3 /app/data/z7note.db "SELECT username FROM users;"
```

如果 testuser 不存在，需要创建：

1. 打开浏览器访问：`http://localhost:3000/login.html`
2. 点击"注册"
3. 创建新用户（例如：username: `testuser`, password: `123456`）

### 问题 2: "连接服务器失败"

**检查服务器是否运行：**
```bash
docker ps | grep z7note
```

**检查日志：**
```bash
docker logs z7note | tail -50
```

**测试服务器连接：**
```bash
curl -v http://localhost:3000/caldav/ \
  -u testuser:123456 \
  -X PROPFIND \
  -H "Depth: 1" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>'
```

应该返回 XML 格式的日历信息。

### 问题 3: 日历没有显示

**刷新日历：**
- 点击菜单栏：**显示** → **刷新 Calendars**
- 或按快捷键 `⌘R`

**检查日历是否启用：**
- 在日历应用左侧边栏，确保你的账户旁边的勾选框已勾选

### 问题 4: 事件不同步

**检查服务器日志：**
```bash
docker logs z7note | grep -i caldav
```

查看是否有认证或处理错误。

**强制同步：**
- 点击菜单栏：**显示** → **刷新 Calendars**
- 重启日历应用

## 本地网络配置（从其他设备访问）

如果你想从同一局域网的其他设备访问：

1. **获取 Mac 的 IP 地址：**
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```

2. **在其他设备上配置：**
   ```
   服务器地址: http://192.168.x.x:3000/caldav/
   ```
   （替换为你的 Mac IP）

3. **确保防火墙允许 3000 端口：**
   ```bash
   # 临时关闭防火墙测试
   sudo pfctl -d

   # 或添加规则允许 3000 端口
   echo "pass in proto tcp from any to any port 3000" | sudo pfctl -ef -
   ```

## HTTPS 配置（用于远程访问）

如果需要从外网访问，需要配置 HTTPS：

1. **使用反向代理（推荐 Nginx）：**

   ```nginx
   server {
       listen 443 ssl;
       server_name your-domain.com;

       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;

       location /caldav/ {
           proxy_pass http://localhost:3000/caldav/;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

2. **使用 Let's Encrypt 获取免费证书：**
   ```bash
   brew install certbot
   sudo certbot certonly --standalone -d your-domain.com
   ```

3. **在 macOS 日历中配置：**
   ```
   服务器地址: https://your-domain.com/caldav/
   ```

## 高级配置

### 添加多个日历

目前 z7Note 每个用户只有一个主日历。如果需要多个日历，需要在服务器端实现：

1. 修改数据库结构添加 `calendar_name` 字段
2. 更新 CalDAV 路由支持多个日历路径
3. 修改客户端配置以使用特定的日历 URL

### 自定义同步频率

macOS 默认的同步频率较高，可以调整：

1. 打开 **系统设置** → **互联网账户**
2. 选择你的 CalDAV 账户
3. 点击 **账户信息**
4. 选择刷新频率

## 测试脚本

运行这个测试脚本验证所有功能：

```bash
#!/bin/bash

echo "=== CalDAV 功能测试 ==="
echo

echo "1. 测试根路径 PROPFIND..."
curl -s -X PROPFIND http://localhost:3000/caldav/ \
  -u testuser:123456 \
  -H "Depth: 1" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>' | grep -q "testuser@z7note" && echo "✅ 根路径 PROPFIND 成功" || echo "❌ 根路径 PROPFIND 失败"

echo
echo "2. 测试用户日历 PROPFIND..."
curl -s -X PROPFIND http://localhost:3000/caldav/testuser/ \
  -u testuser:123456 \
  -H "Depth: 0" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>' | grep -q "testuser" && echo "✅ 用户日历 PROPFIND 成功" || echo "❌ 用户日历 PROPFIND 失败"

echo
echo "3. 测试获取日历数据..."
curl -s http://localhost:3000/caldav/testuser/ \
  -u testuser:123456 | grep -q "BEGIN:VCALENDAR" && echo "✅ 获取日历数据成功" || echo "❌ 获取日历数据失败"

echo
echo "=== 测试完成 ==="
```

保存为 `test-macos-caldav.sh` 并运行：
```bash
chmod +x test-macos-caldav.sh
./test-macos-caldav.sh
```

## 日志分析

查看实时日志：
```bash
docker logs -f z7note | grep -i caldav
```

常见日志信息：

| 日志信息 | 含义 | 操作 |
|---------|------|------|
| `[INFO] Basic Auth 验证成功` | 认证成功 | 正常 |
| `[ERROR] Basic Auth 用户不存在` | 用户不存在 | 检查用户名或创建用户 |
| `[ERROR] 密码错误` | 密码错误 | 检查密码 |
| `[INFO] CalDAV 根路径 PROPFIND` | macOS 发现请求 | 正常 |
| `[ERROR] CalDAV PROPFIND 失败` | 处理请求失败 | 查看详细错误信息 |

## 下一步

配置成功后，你可以：

1. 在日历中创建事件
2. 同步到其他设备（iPhone, iPad, Mac）
3. 使用 z7Note web 界面管理日历
4. 配置定期备份

## 需要帮助？

如果遇到问题，请提供：

1. macOS 版本
2. 日历应用版本
3. 错误信息截图
4. 服务器日志：`docker logs z7note`
5. 配置的 URL（可隐藏密码）
