# iPhone CalDAV 配置修复

## 🔍 问题分析

从测试结果看：
- ✅ HTTPS 访问域名正常（HTTP 207）
- ✅ 局域网访问服务器内部正常
- ❓ iPhone 客户端仍然失败

可能的原因：
1. iPhone 配置时使用的 URL 格式不对
2. 需要使用完整的 CalDAV 路径（包括用户名）
3. iPhone 缓存了之前的错误配置

---

## 📱 iPhone 配置正确方法

### 方法 1：使用完整路径（推荐）

**关键点**: iPhone 的 CalDAV 配置需要使用完整路径，包括用户名！

**配置信息**:
```
服务器: https://z7note.255556.xyz/caldav/testuser/
       或
服务器: http://192.168.2.123:3000/caldav/testuser/

用户名: testuser
密码: 123456

注意: 服务器路径末尾要有 testuser/，并且有斜杠！
```

**详细步骤**:

1. 打开 **设置** → **日历** → **账户** → **添加账户** → **其他**
2. 选择 **CalDAV 账户**
3. 填写：
   ```
   服务器: https://z7note.255556.xyz/caldav/testuser/
   用户名: testuser
   密码: 123456
   描述: z7Note
   ```

   **重要**: 服务器路径必须包含 `/testuser/`！

4. 点击 **下一步**
5. 选择要同步的内容（建议只选"日历"）
6. 点击 **保存**

### 方法 2：使用基础 URL（另一种方式）

**配置信息**:
```
服务器: https://z7note.255556.xyz/caldav/
用户名: testuser
密码: 123456
```

然后 iPhone 会自动发现日历。

### 方法 3：使用本地网络 URL

```
服务器: http://192.168.2.123:3000/caldav/testuser/
用户名: testuser
密码: 123456
```

---

## 🔧 诊断和测试

### 1. 在 iPhone 上测试连接

1. 打开 iPhone 的 **Safari** 浏览器
2. 访问: `https://z7note.255556.xyz`
3. 看是否能打开 z7Note 页面

如果 Safari 能打开，说明网络和 SSL 都正常。

### 2. 测试 CalDAV 端点

在 Mac 或 Linux 终端测试（从外部网络）：

```bash
# 测试 OPTIONS
curl -X OPTIONS https://z7note.255556.xyz/caldav/

# 测试 PROPFIND（完整路径）
curl -X PROPFIND https://z7note.255556.xyz/caldav/testuser/ \
  -H "Authorization: Basic $(echo -n 'testuser:123456' | base64)" \
  -H "Depth: 0"
```

### 3. 查看服务器日志

```bash
docker-compose logs -f | grep -i "caldav\|basic"
```

在 iPhone 尝试配置时，应该看到类似这样的日志：

```
[DEBUG] Basic Auth 尝试 { username: 'testuser' }
[INFO] Basic Auth 验证成功 { username: 'testuser' }
```

或者：

```
[DEBUG] Basic Auth 尝试 { username: 'testuser' }
[ERROR] Basic Auth 密码错误 { username: 'testuser' }
```

---

## ❓ 如果还是失败

### 检查清单

- [ ] 服务器路径是否包含用户名：`/caldav/testuser/`
- [ ] 用户名和密码是否正确（testuser / 123456）
- [ ] iPhone 和服务器是否在同一网络（如果是局域网配置）
- [ ] 是否从旧设备迁移了备份（可能包含旧配置）
- [ ] iPhone 系统版本是否为 iOS 12.2 或更高

### 重新开始配置

1. 删除之前的 CalDAV 账户（如果有）
   - 设置 → 日历 → 账户 → 找到 z7Note 账户
   - 点击账户 → 删除账户

2. 重启 iPhone 日历应用
   - 双击 Home 键，找到日历应用
   - 上滑关闭应用
   - 重新打开日历

3. 使用新配置重新添加
   - 按照"方法 1"的步骤配置

### 清除 iPhone 网络设置

如果以上都不行，尝试：

1. **忘记 Wi-Fi 网络**:
   - 设置 → 无线局域网
   - 点击当前网络旁边的 (i)
   - 点击"忽略此网络"

2. **重新连接 Wi-Fi**:
   - 设置 → 无线局域网
   - 重新连接

3. **重新配置 CalDAV**

---

## 🎯 测试不同配置

尝试以下 3 种配置，看哪种能成功：

### 配置 A: HTTPS + 完整路径
```
服务器: https://z7note.255556.xyz/caldav/testuser/
用户名: testuser
密码: 123456
```

### 配置 B: HTTPS + 基础路径
```
服务器: https://z7note.255556.xyz/caldav/
用户名: testuser
密码: 123456
```

### 配置 C: HTTP + 完整路径
```
服务器: http://192.168.2.123:3000/caldav/testuser/
用户名: testuser
密码: 123456
```

---

## 📊 成功标志

配置成功后，你应该看到：

1. **无错误提示**: 不应该再看到"账号验证失败"
2. **日历显示**: 在日历应用中应该能看到 "z7Note" 日历
3. **能创建事件**: 在日历中创建新事件
4. **同步正常**: 在 Web 界面创建的事件会同步到 iPhone

---

## 🚨 常见错误和解决

### 错误 1: "无法使用SSL连接"

**原因**: SSL 证书问题

**解决**: 使用 HTTP 局域网配置（配置 C）

### 错误 2: "账号验证失败"

**原因**: 用户名或密码错误

**解决**:
1. 确认用户名是 `testuser`（不是 test）
2. 确认密码是 `123456`
3. 查看服务器日志确认

### 错误 3: "无法连接到服务器"

**原因**: 网络问题或服务器地址错误

**解决**:
1. 检查 iPhone 和服务器是否在同一 Wi-Fi（局域网配置）
2. 确认服务器地址正确
3. 尝试在 Safari 中访问服务器地址

### 错误 4: "服务器不支持此功能"

**原因**: URL 路径不正确

**解决**: 使用完整路径，包含 `/testuser/`

---

## 📞 需要更多帮助？

如果以上方法都不行，请提供：

1. **iPhone 系统版本**: 设置 → 通用 → 关于本机 → 软件版本
2. **具体错误信息**: iPhone 显示的确切错误文字
3. **配置方式**: 你使用的是上面 A/B/C 哪种配置
4. **服务器日志**:
   ```bash
   docker-compose logs --tail=50 | grep -i "caldav\|basic"
   ```

---

## 💡 关键提示

**最重要**: iPhone CalDAV 配置的服务器路径必须包含用户名！

正确: `https://z7note.255556.xyz/caldav/testuser/`
错误: `https://z7note.255556.xyz/caldav/`

请仔细检查你的配置中是否包含了 `/testuser/` 这部分！

---

**尝试配置后告诉我结果！** 🚀
