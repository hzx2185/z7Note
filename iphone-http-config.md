# iPhone CalDAV HTTP 配置指南

## 📱 HTTP 配置步骤

由于 iPhone 对 SSL 证书的严格验证，我们可以先使用 HTTP 配置来测试 CalDAV 功能。

### 配置信息

```
服务器地址: http://z7note.255556.xyz:3000/caldav
用户名: snowfly
密码: 您的 z7Note 密码
```

### 详细步骤

1. 打开 iPhone **设置** → **日历** → **账户** → **添加账户** → **其他**

2. 选择 **CalDAV 账户**

3. 输入以下信息：
   - **服务器**: `http://z7note.255556.xyz:3000/caldav`
   - **用户名**: `snowfly`
   - **密码**: 您的 z7Note 密码

4. 点击 **下一步**

5. 选择要同步的内容（日历、提醒事项）

6. 点击 **保存**

## ⚠️ 安全提示

**HTTP 不安全，仅用于测试！**

如果 HTTP 配置成功，说明 CalDAV 功能正常，只是 SSL 证书配置需要调整。

## 🔒 后续 HTTPS 配置

如果 HTTP 配置成功，我们可以尝试以下方法来解决 SSL 问题：

### 方法 1：检查 nginx 配置

确保 nginx 使用完整的证书链：

```nginx
ssl_certificate /path/to/fullchain.pem;  # 必须使用 fullchain.pem
ssl_certificate_key /path/to/privkey.pem;
```

### 方法 2：重新获取证书

```bash
certbot certonly --webroot -w /var/www/html -d z7note.255556.xyz
```

### 方法 3：检查中间证书

确保 Let's Encrypt 的中间证书已经正确配置。

## ✅ 验证步骤

配置完成后：

1. 打开 **日历** 应用
2. 检查是否显示 z7Note 的事件
3. 在日历中创建一个新事件
4. 刷新 z7Note Web 界面，检查是否同步

## 📊 测试命令

```bash
# 测试 HTTP 端点
curl -v -X OPTIONS http://z7note.255556.xyz:3000/caldav/

# 测试 PROPFIND
curl -v -X PROPFIND http://z7note.255556.xyz:3000/caldav/snowfly \
  -H "Authorization: Basic $(echo -n 'snowfly:password' | base64)" \
  -H "Depth: 0"
```

## 🆘 如果 HTTP 也不行

如果 HTTP 配置也失败，请：

1. 检查网络连接
2. 确认用户名和密码正确
3. 查看服务器日志：
   ```bash
   docker-compose logs -f | grep -i caldav
   ```

## 📝 相关文档

- **快速配置**: `IPHONE_QUICK_START.md`
- **修复详情**: `IPHONE_CALDAV_FIX.md`
- **完整文档**: `CALDAV.md`

---

**请先尝试 HTTP 配置，如果成功，我们再解决 SSL 问题。**
