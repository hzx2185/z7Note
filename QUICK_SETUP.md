# CalDAV 客户端快速配置

## 📋 你的 CalDAV 信息

```
服务器地址: http://z7note.255556.xyz/caldav
          或 https://z7note.255556.xyz/caldav (如果已配置 SSL)

用户名: 你的 z7Note 登录用户名
密码: 你的 z7Note 登录密码
```

---

## 📱 iOS / iPadOS 快速配置

### 方法 1：局域网配置（最简单，推荐先测试）

1. 确保 iPhone 和服务器在同一 WiFi 网络
2. 在 iPhone 上打开 **设置** → **日历** → **账户** → **添加账户** → **其他**
3. 选择 **CalDAV 账户**
4. 填写：
   ```
   服务器: http://192.168.x.x:3000/caldav
   （把 192.168.x.x 换成你的服务器局域网 IP）

   用户名: 你的 z7Note 用户名
   密码: 你的 z7Note 密码
   描述: z7Note
   ```
5. 点击 **下一步** → 选择"日历"和"提醒事项" → **保存**

**获取服务器 IP 的方法**：
- 在服务器上运行: `ifconfig` 或 `ip addr`
- 找到类似 `192.168.1.xxx` 或 `10.0.0.xxx` 的地址

### 方法 2：HTTPS 配置

如果方法 1 成功，可以尝试 HTTPS：

```
服务器: https://z7note.255556.xyz/caldav
用户名: 你的 z7Note 用户名
密码: 你的 z7Note 密码
```

**如果提示"无法验证服务器"或"SSL 证书无效"**：

1. 先在 Safari 中访问: https://z7note.255556.xyz
2. 如果能打开，说明证书基本正常
3. 如果在 CalDAV 配置中仍然失败，**使用方法 1 的局域网配置**

---

## 💻 macOS (Mac 电脑) 配置

1. 打开 **日历** 应用
2. 菜单栏：**日历** → **设置** → **账户** → 点击 **+**
3. 选择 **其他 CalDAV 账户**
4. 选择 **账户类型**: 手动
5. 填写：
   ```
   用户名: 你的 z7Note 用户名
   密码: 你的 z7Note 密码
   服务器地址: http://z7note.255556.xyz/caldav
   端口: 3000 (HTTP) 或 443 (HTTPS)
   ```
6. 点击 **登录** → 选择要同步的内容 → **完成**

---

## 🤖 Android 配置

### 方法 1：使用 DAVx⁵（推荐）

1. 在 Google Play 安装 **DAVx⁵**（或从 F-Droid 安装）
2. 打开 DAVx⁵
3. 点击 **+** → **添加账户** → **使用 URL 和用户名登录**
4. 填写：
   ```
   基础 URL: http://z7note.255556.xyz/caldav
   用户名: 你的 z7Note 用户名
   密码: 你的 z7Note 密码
   ```
5. 点击 **创建账户**
6. DAVx⁵ 会自动检测日历和待办事项，选择要同步的
7. 安装一个日历应用（如 Google Calendar）查看数据

### 方法 2：使用 Etar（开源免费）

1. 安装 **Etar 日历**（Google Play 或 F-Droid）
2. 打开 Etar
3. 左上角菜单 → **设置** → **日历** → **+**
4. 选择 **CalDAV**
5. 填写与 DAVx⁵ 相同的信息

---

## 🪟 Windows 配置

### 推荐：使用 Thunderbird

1. 下载安装 [Thunderbird](https://www.thunderbird.net/)
2. 安装时会提示安装 **Lightning** 日历扩展（日历功能）
3. 打开 Thunderbird
4. **事件** → **新建事件** → 左上角齿轮 → **设置**
5. **账户** → **添加账户** → **配置手动**
6. 选择 **CalDAV**
7. 填写：
   ```
   用户名: 你的 z7Note 用户名
   密码: 你的 z7Note 密码
   URL: http://z7note.255556.xyz/caldav
   ```
8. 点击 **继续** → **完成**

---

## 🐧 Linux 配置

### GNOME (Ubuntu, Fedora 等)

1. 打开 **设置** → **在线账户**
2. 点击 **+** → **其他**
3. 选择 **CalDAV**
4. 填写：
   ```
   用户名: 你的 z7Note 用户名
   密码: 你的 z7Note 密码
   URL: http://z7note.255556.xyz/caldav
   ```
5. 点击 **连接**

---

## ✅ 验证配置是否成功

### 在客户端中：

1. 打开日历应用
2. 应该能看到名为 "z7Note" 或用户名的日历
3. 尝试在日历中创建一个新事件
4. 打开 z7Note Web 界面: http://z7note.255556.xyz/calendar.html
5. 检查事件是否同步

### 在浏览器中：

```bash
# 测试健康检查
curl http://z7note.255556.xyz/health

# 应该返回: {"status":"ok","timestamp":...}
```

---

## 🔧 常见问题

### ❓ 问题 1: iPhone 提示"无法使用SSL连接"

**解决方案**：

**方法 A（推荐）**: 使用局域网 HTTP 配置
```
服务器: http://192.168.x.x:3000/caldav
```

**方法 B**: 手动信任证书
1. Safari 访问 https://z7note.255556.xyz
2. 设置 → 通用 → 关于本机 → 证书信任设置
3. 找到证书，启用"针对根证书启用完全信任"

### ❓ 问题 2: 提示"账户验证失败"

**检查**:
1. 用户名和密码是否正确（可以在 Web 界面登录测试）
2. 服务器地址是否正确
3. 网络连接是否正常
4. 查看服务器日志: `docker-compose logs -f`

### ❓ 问题 3: 事件不同步

**解决步骤**:
1. 在客户端下拉刷新日历
2. 在 z7Note Web 界面检查事件是否存在
3. 尝试删除账户重新添加
4. 检查客户端是否选择了正确的日历

### ❓ 问题 4: 局域网也连接不上

**检查**:
1. iPhone 和服务器是否在同一 WiFi
2. 确认服务器 IP 地址（在服务器上运行 `ifconfig`）
3. 测试连接: 在 iPhone 的 Safari 中访问 `http://192.168.x.x:3000`
4. 检查服务器防火墙是否开放端口 3000

---

## 🧪 快速测试

在终端运行以下命令测试 CalDAV：

```bash
# 1. 测试服务器是否运行
curl http://z7note.255556.xyz/health

# 2. 测试 CalDAV 能力
curl -X OPTIONS http://z7note.255556.xyz/caldav/

# 3. 测试认证（替换 username:password）
curl -X PROPFIND http://z7note.255556.xyz/caldav/你的用户名 \
  -H "Authorization: Basic $(echo -n '用户名:密码' | base64)" \
  -H "Depth: 0"
```

---

## 📞 需要帮助？

如果以上方法都不行，请提供以下信息：

1. 你的操作系统和版本（例如：iOS 15.5, macOS 13.0）
2. 使用的客户端（例如：iOS 日历, DAVx⁵）
3. 具体的错误信息
4. 是否能访问 http://z7note.255556.xyz/health

---

## 📚 更多文档

- **详细客户端配置**: `CALDAV_CLIENTS.md`
- **日历功能指南**: `CALENDAR_GUIDE.md`
- **SSL 故障排除**: `SSL_TROUBLESHOOTING.md`

---

**💡 建议**: 先使用局域网 HTTP 配置测试，确认功能正常后再尝试 HTTPS 配置。
