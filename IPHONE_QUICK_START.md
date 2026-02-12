# iPhone CalDAV 快速配置指南

## 🎯 配置信息

```
服务器地址: https://z7note.255556.xyz/caldav
用户名: snowfly
密码: 您的 z7Note 密码
```

## 📱 配置步骤

### 方法一：HTTPS（推荐）

1. 打开 iPhone **设置** → **日历** → **账户** → **添加账户** → **其他**
2. 选择 **CalDAV 账户**
3. 输入以下信息：
   - **服务器**: `https://z7note.255556.xyz/caldav`
   - **用户名**: `snowfly`
   - **密码**: 您的 z7Note 密码
4. 点击 **下一步**
5. 选择要同步的内容（日历、提醒事项）
6. 点击 **保存**

### 方法二：HTTP（仅测试）

如果遇到 SSL 问题，可以临时使用 HTTP：

1. 打开 iPhone **设置** → **日历** → **账户** → **添加账户** → **其他**
2. 选择 **CalDAV 账户**
3. 输入以下信息：
   - **服务器**: `http://z7note.255556.xyz:3000/caldav`
   - **用户名**: `snowfly`
   - **密码**: 您的 z7Note 密码
4. 点击 **下一步**
5. 选择要同步的内容（日历、提醒事项）
6. 点击 **保存**

## ✅ 验证步骤

### 1. 检查 SSL 证书

在 Safari 中访问：`https://z7note.255556.xyz`

如果可以正常访问，说明 SSL 证书正常。

### 2. 查看同步状态

1. 打开 **日历** 应用
2. 检查是否显示 z7Note 的事件和待办
3. 在日历中创建一个新事件
4. 刷新 z7Note Web 界面，检查是否同步

### 3. 测试同步

在 z7Note Web 界面中：
1. 创建一个新事件
2. 等待几秒钟
3. 打开 iPhone 日历，检查是否显示

在 iPhone 日历中：
1. 创建一个新事件
2. 等待几秒钟
3. 刷新 z7Note Web 界面，检查是否显示

## 🔧 故障排除

### 问题：无法验证 SSL 证书

**解决方案：**

1. **检查服务器时间**
   ```bash
   date
   ```
   确保服务器时间准确。

2. **测试 SSL 连接**
   ```bash
   curl -v https://z7note.255556.xyz/caldav/
   ```
   查看是否显示 `SSL certificate verify ok`

3. **使用 HTTP 临时测试**
   - 服务器地址: `http://z7note.255556.xyz:3000/caldav`

### 问题：认证失败

**解决方案：**

1. 确认用户名和密码正确
2. 在 z7Note Web 界面登录验证
3. 检查服务器日志：
   ```bash
   docker-compose logs -f | grep -i caldav
   ```

### 问题：无法同步

**解决方案：**

1. 手动刷新同步：
   - 打开 **日历** 应用
   - 下拉刷新

2. 检查网络连接

3. 重启 iPhone 日历：
   - 双击 Home 键，上滑关闭日历
   - 重新打开日历

4. 删除并重新添加账户：
   - **设置** → **日历** → **账户**
   - 选择 CalDAV 账户
   - **删除账户**
   - 重新添加账户

## 📊 常见错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| 401 | 认证失败 | 检查用户名和密码 |
| 403 | 权限不足 | 确认用户名正确 |
| 404 | 路由不存在 | 检查服务器地址 |
| 500 | 服务器错误 | 查看服务器日志 |

## 🧪 测试命令

### 测试 OPTIONS 请求

```bash
curl -v -X OPTIONS https://z7note.255556.xyz/caldav/
```

### 测试 PROPFIND 请求

```bash
curl -v -X PROPFIND https://z7note.255556.xyz/caldav/snowfly \
  -H "Authorization: Basic $(echo -n 'snowfly:password' | base64)" \
  -H "Depth: 0"
```

### 测试 GET 请求

```bash
curl -v https://z7note.255556.xyz/caldav/snowfly \
  -H "Authorization: Basic $(echo -n 'snowfly:password' | base64)"
```

## 📝 相关文档

- **完整文档**: `CALDAV.md`
- **修复详情**: `IPHONE_CALDAV_FIX.md`
- **测试脚本**: `test-iphone-caldav.sh`

## 🎉 配置完成

如果配置成功，您应该能够：

1. ✅ 在 iPhone 日历中看到 z7Note 的事件
2. ✅ 在 iPhone 提醒事项中看到 z7Note 的待办
3. ✅ 在 iPhone 中创建事件，同步到 z7Note
4. ✅ 在 z7Note 中创建事件，同步到 iPhone
5. ✅ 双向同步工作正常

## 💡 提示

- **同步频率**: 由 iPhone 自动控制，通常几分钟到几小时
- **手动同步**: 在日历应用中下拉刷新
- **网络要求**: 需要稳定的网络连接
- **存储空间**: 事件和待办数据很小，不会占用太多空间

## 🆘 需要帮助？

如果遇到问题：

1. 查看服务器日志：
   ```bash
   docker-compose logs -f | grep -i caldav
   ```

2. 运行测试脚本：
   ```bash
   ./test-iphone-caldav.sh
   ```

3. 查看详细文档：
   ```bash
   cat CALDAV.md
   cat IPHONE_CALDAV_FIX.md
   ```

---

**祝您使用愉快！** 🎊
