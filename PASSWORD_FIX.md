# CalDAV 密码问题解决方案

## 📋 问题诊断

**当前状况**:
- ✅ CalDAV 服务正常运行
- ✅ OPTIONS 请求正常
- ❌ 认证失败（密码错误）

**日志显示**:
```
[DEBUG] Basic Auth 尝试 { username: 'snowfly' }
[ERROR] Basic Auth 密码错误 { username: 'snowfly' }
```

## 🔍 原因

CalDAV 使用与 z7Note Web 界面相同的用户名和密码进行认证。
如果认证失败，说明：
1. 提供的密码不正确
2. 或者数据库中的密码与 Web 界面不一致

## ✅ 解决方案

### 方案 1: 使用正确的密码（推荐）

**步骤**:

1. 打开 z7Note Web 界面：
   ```
   http://z7note.255556.xyz
   ```

2. 使用用户名 `snowfly` 和你的密码登录

3. 确认密码正确

4. 在 CalDAV 客户端中使用相同的密码：
   ```
   服务器: http://192.168.2.123:3000/caldav
   用户名: snowfly
   密码: 你在 Web 界面使用的密码（不是 snowfly！）
   ```

### 方案 2: 重置密码

如果忘记了密码：

1. 打开登录页面: http://z7note.255556.xyz/login.html
2. 点击"忘记密码"
3. 输入你的邮箱地址
4. 按照邮件提示重置密码
5. 使用新密码配置 CalDAV

### 方案 3: 在服务器直接重置密码

**警告**: 仅在无法使用方案 1 和 2 时使用

1. 登录到服务器
2. 运行以下命令生成新密码的哈希：

   ```bash
   docker exec z7note node -e "
   const bcrypt = require('bcrypt');
   bcrypt.hash('新密码', 10).then(hash => {
       console.log('Password hash:', hash);
       process.exit(0);
   });
   "
   ```

3. 更新数据库密码：

   ```bash
   docker exec z7note sqlite3 /app/data/z7note.db "
   UPDATE users
   SET password = '上面输出的哈希值'
   WHERE username = 'snowfly';
   "
   ```

4. 使用新密码在 Web 界面和 CalDAV 客户端登录

## 🧪 测试密码

使用这个命令测试密码是否正确：

```bash
# 替换为实际的密码
curl -X PROPFIND http://localhost:3000/caldav/snowfly \
  -H "Authorization: Basic $(echo -n 'snowfly:你的密码' | base64)" \
  -H "Depth: 0"
```

**成功响应**: HTTP 200 或 207，返回 XML 格式的日历属性
**失败响应**: HTTP 401，返回 "Unauthorized"

## 📱 配置 iPhone（使用正确的密码）

```
服务器: http://192.168.2.123:3000/caldav
用户名: snowfly
密码: 你在 Web 界面使用的密码（确认密码正确！）
```

**配置步骤**:
1. 设置 → 日历 → 账户 → 添加账户 → 其他
2. 选择 CalDAV 账户
3. 填写以上信息
4. 下一步 → 选择同步内容 → 保存

## 📊 日志查看

查看实时日志：

```bash
docker-compose logs -f | grep -i "basic\|caldav\|auth"
```

你应该看到类似这样的成功日志：

```
[DEBUG] Basic Auth 尝试 { username: 'snowfly' }
[INFO] Basic Auth 验证成功 { username: 'snowfly' }
```

## ❓ 常见问题

### Q: 为什么密码测试都不对？

A: 因为数据库中的密码不是 "snowfly"、"admin" 等常见密码，而是你注册或设置的实际密码。

### Q: 我忘记了密码怎么办？

A:
1. 使用 Web 界面的"忘记密码"功能
2. 或者使用方案 3 在服务器直接重置

### Q: 为什么 Web 界面可以登录，但 CalDAV 不行？

A: 请确认两者使用相同的密码。CalDAV 和 Web 界面使用相同的用户数据库和密码验证。

### Q: 我改了密码，还是认证失败？

A:
1. 确认 CalDAV 客户端中的密码已更新
2. 删除 CalDAV 账户重新添加
3. 查看日志确认新密码被使用

## 🎯 快速开始

1. **在浏览器中登录**: http://z7note.255556.xyz
   - 用户名: snowfly
   - 密码: 你的实际密码

2. **确认登录成功后**，配置 CalDAV:
   - 服务器: http://192.168.2.123:3000/caldav
   - 用户名: snowfly
   - 密码: 刚才登录使用的相同密码

3. **测试配置**:
   ```bash
   curl -X PROPFIND http://192.168.2.123:3000/caldav/snowfly \
     -H "Authorization: Basic $(echo -n 'snowfly:你的密码' | base64)" \
     -H "Depth: 0"
   ```

---

## 🔧 密码测试脚本

我已经创建了 `test-password.sh` 脚本来帮你测试密码：

```bash
# 方法 1: 修改脚本中的密码列表
vim test-password.sh
# 在 PASSWORDS 数组中添加你的密码

# 方法 2: 手动测试单个密码
curl -X PROPFIND http://localhost:3000/caldav/snowfly \
  -H "Authorization: Basic $(echo -n 'snowfly:你的密码' | base64)" \
  -H "Depth: 0"
```

---

**重要提示**: CalDAV 认证使用的是 z7Note Web 界面的登录密码，不是任何默认密码！

请确认你在 Web 界面使用的正确密码后，再配置 CalDAV 客户端。
