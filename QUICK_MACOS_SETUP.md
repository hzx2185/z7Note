# macOS 日历应用快速配置

## ⚡ 快速配置（3步搞定）

### 步骤 1: 打开日历应用

在你的 Mac 上打开"日历"应用

### 步骤 2: 添加账户

1. 点击菜单栏：**日历** → **账户**
2. 点击 **+** 按钮
3. 选择 **其他 CalDAV 账户**

### 步骤 3: 填写信息

```
账户类型: CalDAV
用户名: testuser
密码: 123456
服务器地址: http://localhost:3000/caldav/
```

点击 **创建**，完成！✅

---

## 🧪 验证配置

运行测试脚本：
```bash
./test-macos-caldav.sh
```

所有测试应该显示 ✅

---

## 📱 其他客户端

### Thunderbird（跨平台）
```bash
# 安装
brew install --cask thunderbird

# 配置
位置: http://localhost:3000/caldav/testuser/
用户名: testuser
密码: 123456
```

### iPhone 日历
```
服务器: https://your-domain.com/caldav/
用户名: testuser
密码: 123456
```

---

## 🛠️ 故障排查

### "无法验证账号名或密码"

1. 确认 testuser 存在：
```bash
docker exec -it z7note sqlite3 /app/data/z7note.db "SELECT username FROM users;"
```

2. 如果不存在，创建用户：
   - 访问 `http://localhost:3000/login.html`
   - 点击"注册"
   - 创建用户 testuser/123456

### 连接失败

检查服务器：
```bash
docker ps | grep z7note
docker logs z7note | tail -20
```

手动测试：
```bash
curl -v http://localhost:3000/caldav/ -u testuser:123456
```

---

## 📚 详细文档

- `MACOS_CALDAV_SETUP.md` - 完整配置指南
- `CALDAV_WORKING.md` - CalDAV 技术文档
- `test-macos-caldav.sh` - 测试脚本
