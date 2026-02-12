# iPhone 局域网 HTTP CalDAV 配置

## 🎯 最简单的解决方案

由于 SSL 证书在 iPhone 上有兼容性问题，我们可以使用局域网 HTTP 配置来测试 CalDAV 功能。

## 📋 前提条件

1. iPhone 和服务器在**同一局域网**（连接到同一个 Wi-Fi）
2. 知道服务器的**局域网 IP 地址**

## 🔍 获取服务器 IP 地址

### 方法 1：在服务器上查看

```bash
ip addr show | grep inet
```

或者：

```bash
ifconfig | grep inet
```

找到类似 `192.168.x.x` 或 `10.x.x.x` 的地址。

### 方法 2：在路由器管理界面查看

1. 打开浏览器访问路由器管理界面（通常是 `192.168.1.1` 或 `192.168.0.1`）
2. 查看已连接设备列表
3. 找到服务器设备，查看其 IP 地址

## 📱 iPhone 配置步骤

### 配置信息

```
服务器地址: http://[服务器IP]:3000/caldav
用户名: snowfly
密码: 您的 z7Note 密码
```

### 详细步骤

1. **确保 iPhone 和服务器在同一网络**
   - 打开 iPhone **设置** → **无线局域网**
   - 确认已连接到与服务器相同的 Wi-Fi

2. **打开 CalDAV 配置**
   - 打开 iPhone **设置** → **日历** → **账户** → **添加账户** → **其他**
   - 选择 **CalDAV 账户**

3. **输入服务器信息**
   - **服务器**: `http://192.168.x.x:3000/caldav`（替换为实际的服务器 IP）
   - **用户名**: `snowfly`
   - **密码**: 您的 z7Note 密码

4. **完成配置**
   - 点击 **下一步**
   - 选择要同步的内容（日历、提醒事项）
   - 点击 **保存**

## ✅ 验证步骤

### 1. 检查连接

在 iPhone 的 Safari 浏览器中访问：

```
http://192.168.x.x:3000
```

如果可以访问 z7Note Web 界面，说明连接正常。

### 2. 测试 CalDAV

```bash
# 在服务器上测试
curl -v -X OPTIONS http://192.168.x.x:3000/caldav/
```

### 3. 检查同步

1. 打开 iPhone **日历** 应用
2. 检查是否显示 z7Note 的事件
3. 在日历中创建一个新事件
4. 刷新 z7Note Web 界面，检查是否同步

## 🔧 如果局域网也不行

### 检查防火墙

确保服务器的防火墙允许端口 3000：

```bash
# Ubuntu/Debian
sudo ufw allow 3000

# CentOS/RHEL
sudo firewall-cmd --add-port=3000/tcp --permanent
sudo firewall-cmd --reload
```

### 检查 Docker 端口映射

确保 Docker 容器的端口映射正确：

```bash
docker ps | grep z7note
```

应该显示：`0.0.0.0:3000->3000/tcp`

### 检查服务器监听地址

确保服务器监听所有网络接口：

```bash
netstat -tlnp | grep 3000
```

应该显示：`0.0.0.0:3000`（监听所有接口）

## ⚠️ 安全提示

**局域网 HTTP 配置仅用于测试！**

- 仅在可信的局域网环境中使用
- 不要在公共网络中使用
- 生产环境必须使用 HTTPS

## 🚀 后续步骤

### 如果局域网配置成功

说明 CalDAV 功能正常，只是 SSL 证书需要调整。

可以尝试以下方法解决 SSL 问题：

1. **手动信任 Let's Encrypt 证书**（参考 `SSL_TROUBLESHOOTING.md`）
2. **使用商业 SSL 证书**
3. **升级 iOS 系统版本**

### 如果局域网配置也失败

请检查：

1. 网络连接是否正常
2. 防火墙是否阻止了连接
3. Docker 容器是否正常运行
4. 用户名和密码是否正确

## 📊 测试命令

### 在服务器上测试

```bash
# 替换为实际的服务器 IP
SERVER_IP="192.168.x.x"

# 测试 OPTIONS 请求
curl -v -X OPTIONS http://${SERVER_IP}:3000/caldav/

# 测试 PROPFIND 请求
curl -v -X PROPFIND http://${SERVER_IP}:3000/caldav/snowfly \
  -H "Authorization: Basic $(echo -n 'snowfly:password' | base64)" \
  -H "Depth: 0"

# 查看服务器日志
docker-compose logs -f | grep -i caldav
```

### 在 iPhone 上测试

在 Safari 中访问：

```
http://192.168.x.x:3000/health
```

应该显示：`{"status":"ok","timestamp":...}`

## 📝 相关文档

- **SSL 故障排除**: `SSL_TROUBLESHOOTING.md`
- **快速配置**: `IPHONE_QUICK_START.md`
- **修复详情**: `IPHONE_CALDAV_FIX.md`
- **完整文档**: `CALDAV.md`

## 🆘 常见问题

### Q: 如何找到服务器的 IP 地址？

A: 在服务器上运行：
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

### Q: iPhone 无法连接到服务器？

A: 检查以下几点：
1. 确认 iPhone 和服务器在同一 Wi-Fi 网络
2. 检查服务器防火墙设置
3. 确认 Docker 容器正在运行
4. 尝试 ping 服务器 IP 地址

### Q: 配置成功但不同步？

A: 尝试以下操作：
1. 在日历应用中下拉刷新
2. 重启 iPhone 日历应用
3. 删除并重新添加 CalDAV 账户

---

**请先尝试局域网 HTTP 配置，如果成功，我们再解决 SSL 问题。**
