# CalDAV 配置成功！

## ✅ 测试结果

CalDAV 服务已经正常工作！

### 测试账户
```
用户名: testuser
密码: 123456
```

### 测试结果
- ✅ PROPFIND 请求成功（HTTP 207）
- ✅ GET 请求成功（返回 iCal 格式）
- ✅ Basic Auth 认证正常
- ✅ 日志显示: `INFO: Basic Auth 验证成功`

---

## 📱 iPhone 配置（使用 testuser 账户）

### 局域网配置（推荐）

1. 打开 **设置** → **日历** → **账户** → **添加账户** → **其他**
2. 选择 **CalDAV 账户**
3. 填写以下信息：
   ```
   服务器: http://192.168.2.123:3000/caldav
   用户名: testuser
   密码: 123456
   描述: z7Note 测试
   ```
4. 点击 **下一步**
5. 选择要同步的内容（日历、提醒事项）
6. 点击 **保存**

### 域名配置（HTTPS）

```
服务器: https://z7note.255556.xyz/caldav
用户名: testuser
密码: 123456
```

**注意**: 如果提示 SSL 错误，使用上面的局域网配置。

---

## 🧪 测试命令

### 1. 测试健康检查

```bash
curl http://localhost:3000/health
```

### 2. 测试 CalDAV OPTIONS

```bash
curl -X OPTIONS http://localhost:3000/caldav/
```

### 3. 测试 PROPFIND (认证)

```bash
curl -X PROPFIND http://localhost:3000/caldav/testuser \
  -H "Authorization: Basic $(echo -n 'testuser:123456' | base64)" \
  -H "Depth: 0"
```

### 4. 获取 iCal 数据

```bash
curl http://localhost:3000/caldav/testuser \
  -H "Authorization: Basic $(echo -n 'testuser:123456' | base64)"
```

### 5. 从外部测试

```bash
# 替换为实际的服务器 IP
curl -X PROPFIND http://192.168.2.123:3000/caldav/testuser \
  -H "Authorization: Basic $(echo -n 'testuser:123456' | base64)" \
  -H "Depth: 0"
```

---

## 📊 日志查看

```bash
# 查看实时日志
docker-compose logs -f | grep -i "basic\|caldav"

# 成功的日志应该显示：
[DEBUG] Basic Auth 尝试 { username: 'testuser' }
[INFO] Basic Auth 验证成功 { username: 'testuser' }
```

---

## 🎯 配置其他用户

如果你想在其他账户（如 snowfly）上使用 CalDAV：

### 方法 1: 使用 Web 界面确认密码

1. 访问: http://z7note.255556.xyz
2. 使用 snowfly 账户登录
3. 确认密码正确
4. 在 CalDAV 客户端使用相同的密码

### 方法 2: 重置密码

如果忘记了 snowfly 的密码：

```bash
# 生成新密码的哈希（例如：newpassword123）
docker exec z7note node -e "
const bcrypt = require('bcrypt');
bcrypt.hashSync('newpassword123', 10);
"

# 更新数据库（替换为上面输出的哈希）
docker exec z7note sqlite3 /app/data/z7note.db "
UPDATE users SET password = '上面输出的哈希'
WHERE username = 'snowfly';
"
```

然后在 CalDAV 中使用：
```
用户名: snowfly
密码: newpassword123
```

---

## 💻 Web 界面使用

### 访问日历页面

```
http://z7note.255556.xyz/calendar.html
```

### 创建测试数据

1. 登录后点击"日历"按钮
2. 选择日期
3. 点击侧边栏的"+ 添加"按钮
4. 创建待办事项或事件
5. 在 CalDAV 客户端中查看是否同步

---

## ✨ 验证同步

### 在 iPhone 上验证

1. 打开 **日历** 应用
2. 应该能看到 "z7Note 测试" 日历
3. 尝试创建一个新事件
4. 打开 z7Note Web 界面检查是否同步

### 在 Web 界面验证

1. 在日历页面创建事件
2. 在 iPhone 日历应用中查看是否显示
3. 应该能在几分钟内自动同步

---

## 📚 相关文档

- **快速配置**: `QUICK_SETUP.md`
- **客户端配置**: `CALDAV_CLIENTS.md`
- **密码问题**: `PASSWORD_FIX.md`
- **使用指南**: `CALENDAR_GUIDE.md`

---

## 🎉 总结

CalDAV 功能已经完全修复并测试通过！

**可以使用的账户**:
- testuser / 123456

**可以使用的服务器地址**:
- 局域网: http://192.168.2.123:3000/caldav
- 域名: https://z7note.255556.xyz/caldav

**下一步**:
1. 在 iPhone 上使用上面的 testuser 账户配置 CalDAV
2. 验证同步功能
3. 如果需要，配置其他账户（使用正确密码）

---

**现在可以开始使用了！** 🚀
