# iPhone CalDAV 配置 - 最终解决方案

## 🎯 问题总结

iPhone 配置 CalDAV 时提示"无法使用SSL连接"。

## 🔍 问题原因

iPhone 对 Let's Encrypt SSL 证书的兼容性问题，虽然证书在 curl 中验证通过，但 iPhone 可能：
1. iOS 系统版本较旧
2. 根证书库不包含 Let's Encrypt 的根证书
3. 对某些加密算法不支持

## ✅ 推荐解决方案

### 方案 1：使用局域网 HTTP（推荐，最简单）

**适用于：iPhone 和服务器在同一局域网**

#### 配置信息

```
服务器地址: http://192.168.2.163:3000/caldav
用户名: snowfly
密码: 您的 z7Note 密码
```

**注意：** `192.168.2.163` 是您的主要局域网 IP 地址，如果您的 iPhone 连接到不同的网络，请使用对应的 IP 地址。

#### 详细步骤

1. **确保 iPhone 和服务器在同一 Wi-Fi 网络**

2. **在 Safari 中测试连接**
   - 打开 Safari，访问：`http://192.168.2.163:3000`
   - 如果可以看到 z7Note 界面，说明连接正常

3. **配置 CalDAV**
   - 打开 **设置** → **日历** → **账户** → **添加账户** → **其他**
   - 选择 **CalDAV 账户**
   - 输入：
     - **服务器**: `http://192.168.2.163:3000/caldav`
     - **用户名**: `snowfly`
     - **密码**: 您的 z7Note 密码
   - 点击 **下一步**
   - 选择要同步的内容（日历、提醒事项）
   - 点击 **保存**

### 方案 2：手动信任 SSL 证书

**适用于：需要使用 HTTPS**

#### 详细步骤

1. **在 Safari 中访问服务器**
   - 打开 Safari，访问：`https://z7note.255556.xyz`

2. **查看证书详情**
   - 点击地址栏的锁图标 🔒
   - 点击"证书"或"显示证书"

3. **安装证书**
   - 如果有"安装"按钮，点击安装
   - 进入 **设置** → **已下载的描述文件**
   - 找到证书并安装

4. **完全信任证书**
   - 进入 **设置** → **通用** → **关于本机** → **证书信任设置**
   - 找到该证书
   - 启用"针对根证书启用完全信任"

5. **重新配置 CalDAV**
   - 使用 HTTPS 地址：`https://z7note.255556.xyz/caldav`
   - 其他配置信息相同

### 方案 3：升级 iOS 系统

**适用于：iOS 版本较旧**

1. **检查当前 iOS 版本**
   - **设置** → **通用** → **关于本机** → **软件版本**

2. **升级到 iOS 12 或更高版本**
   - **设置** → **通用** → **软件更新**
   - 如果有更新，点击"下载并安装"

3. **升级后重新配置 CalDAV**
   - 使用 HTTPS 地址：`https://z7note.255556.xyz/caldav`

### 方案 4：使用其他 CalDAV 客户端

**适用于：iPhone 日历应用不支持**

推荐以下 CalDAV 客户端：

1. **Calendars 5** (Readdle)
   - App Store 搜索 "Calendars 5"
   - 对 SSL 证书兼容性更好

2. **Fantastical**
   - 功能强大的日历应用
   - 智能自然语言输入

3. **BusyCal**
   - macOS 也有版本
   - 支持多种日历服务

## 🧪 测试步骤

### 测试 1：检查网络连接

在 iPhone Safari 中访问：

```
http://192.168.2.163:3000/health
```

应该显示：`{"status":"ok","timestamp":...}`

### 测试 2：测试 CalDAV 端点

在服务器上运行：

```bash
curl -v -X OPTIONS http://192.168.2.163:3000/caldav/
```

应该返回：`HTTP/1.1 200 OK` 和 DAV 响应头

### 测试 3：测试认证

```bash
curl -v -X PROPFIND http://192.168.2.163:3000/caldav/snowfly \
  -H "Authorization: Basic $(echo -n 'snowfly:password' | base64)" \
  -H "Depth: 0"
```

应该返回：`HTTP/1.1 207 Multi-Status`

## 🔧 故障排除

### 如果局域网连接失败

#### 1. 检查防火墙

```bash
# macOS
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/docker

# 或者临时关闭防火墙测试
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off
```

#### 2. 检查 Docker 端口映射

```bash
docker ps | grep z7note
```

应该显示：`0.0.0.0:3000->3000/tcp`

#### 3. 检查服务器监听

```bash
netstat -an | grep 3000
```

应该显示：`0.0.0.0.3000` 或 `*.3000`

### 如果认证失败

1. **确认用户名和密码正确**
2. **在 Web 界面登录验证**
3. **查看服务器日志**：
   ```bash
   docker-compose logs -f | grep -i caldav
   ```

### 如果同步不生效

1. **手动刷新同步**
   - 在日历应用中下拉刷新

2. **重启日历应用**
   - 双击 Home 键，上滑关闭日历
   - 重新打开日历

3. **删除并重新添加账户**
   - **设置** → **日历** → **账户**
   - 选择 CalDAV 账户
   - **删除账户**
   - 重新添加账户

## ⚠️ 安全提示

**局域网 HTTP 配置仅用于测试！**

- 仅在可信的局域网环境中使用
- 不要在公共网络中使用
- 生产环境必须使用 HTTPS

## 📊 服务器信息

```
域名: z7note.255556.xyz
局域网 IP: 192.168.2.163
HTTP 端口: 3000
HTTPS 端口: 443
用户名: snowfly
```

## 📝 相关文档

| 文档 | 说明 |
|------|------|
| `LOCAL_HTTP_CONFIG.md` | 局域网 HTTP 配置详细指南 |
| `SSL_TROUBLESHOOTING.md` | SSL 证书故障排除 |
| `IPHONE_QUICK_START.md` | 快速配置指南 |
| `IPHONE_CALDAV_FIX.md` | 修复详情和技术说明 |
| `CALDAV.md` | CalDAV 功能完整文档 |

## 🆘 需要帮助？

如果以上方案都无法解决问题，请提供以下信息：

1. **iOS 版本**
   ```
   设置 → 通用 → 关于本机 → 软件版本
   ```

2. **具体的错误信息**
   - iPhone 显示的确切错误消息

3. **网络连接状态**
   - iPhone 是否可以访问 `http://192.168.2.163:3000`
   - iPhone 是否可以访问 `https://z7note.255556.xyz`

4. **服务器日志**
   ```bash
   docker-compose logs -f | grep -i caldav
   ```

## 🎉 预期结果

配置成功后，您应该能够：

1. ✅ 在 iPhone 日历中看到 z7Note 的事件
2. ✅ 在 iPhone 提醒事项中看到 z7Note 的待办
3. ✅ 在 iPhone 中创建事件，同步到 z7Note
4. ✅ 在 z7Note 中创建事件，同步到 iPhone
5. ✅ 双向同步工作正常

---

**建议先尝试方案 1（局域网 HTTP），如果成功，说明功能正常，然后再解决 SSL 问题。**
