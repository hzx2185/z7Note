# CalDAV 客户端完整配置指南

## 🎯 快速测试

### 1. 测试服务器连接

```bash
# 健康检查
curl http://your-server:3000/health

# 测试 CalDAV OPTIONS
curl -X OPTIONS http://your-server:3000/caldav/
```

### 2. 获取您的 CalDAV 配置信息

- **服务器地址**: `http://your-server:3000/caldav` 或 `https://your-domain.com/caldav`
- **用户名**: 您的 z7Note 用户名
- **密码**: 您的 z7Note 密码（登录 Web 界面使用的密码）

---

## 📱 客户端配置

### 1. iOS / iPadOS (iPhone/iPad)

#### 日历应用配置

1. 打开 **设置** → **日历** → **账户** → **添加账户**
2. 选择 **其他**
3. 选择 **CalDAV 账户**
4. 填写信息：
   ```
   服务器: http://your-server:3000/caldav
   用户名: 您的 z7Note 用户名
   密码: 您的 z7Note 密码
   描述: z7Note 日历
   ```
5. 点击 **下一步**
6. 选择要同步的内容（日历、提醒事项）
7. 点击 **保存**

#### 提醒事项应用配置

1. 打开 **设置** → **提醒事项** → **账户** → **添加账户**
2. 选择 **其他**
3. 选择 **CalDAV 账户**
4. 填写相同的信息
5. 点击 **下一步** → **保存**

#### 常见问题

**问题**: "无法使用SSL连接"

**解决方案 A - 使用局域网 HTTP（推荐测试）**:
```
服务器: http://192.168.x.x:3000/caldav
```

**解决方案 B - 手动信任证书**:
1. 在 Safari 中访问 `https://your-domain.com`
2. 安装证书
3. **设置** → **通用** → **关于本机** → **证书信任设置**
4. 启用"针对根证书启用完全信任"

**解决方案 C - 升级 iOS**:
- iOS 12.2+ 完整支持 Let's Encrypt 证书

### 2. macOS (Mac 电脑)

#### 日历应用配置

1. 打开 **日历** 应用
2. **日历** 菜单 → **设置** → **账户** → **+** → **其他 CalDAV 账户**
3. 选择 **账户类型**: **手动**
4. 填写信息：
   ```
   用户名: 您的 z7Note 用户名
   密码: 您的 z7Note 密码
   服务器地址: http://your-server:3000/caldav
   端口: 3000 (HTTP) 或 443 (HTTPS)
   ```
5. 点击 **登录**
6. 选择要同步的内容
7. 点击 **完成**

#### 提醒事项应用配置

1. 打开 **提醒事项** 应用
2. **提醒事项** 菜单 → **设置** → **账户** → **+** → **其他 CalDAV 账户**
3. 按照日历应用的步骤配置

### 3. Android

#### Google Calendar

1. 打开 **设置** → **账户** → **添加账户**
2. 选择 **CalDAV**
3. 填写信息：
   ```
   服务器地址: http://your-server:3000/caldav
   用户名: 您的 z7Note 用户名
   密码: 您的 z7Note 密码
   ```
4. 点击 **下一步** → **完成**

#### 其他日历应用

推荐使用以下第三方应用：

1. **Etar** - 开源免费
   - 侧边栏菜单 → **设置** → **日历** → **+**
   - 选择 **CalDAV**
   - 填写服务器信息和凭证

2. **DAVx⁵** (需要配合应用)
   - 安装 DAVx⁵
   - 添加账户 → **选择 CalDAV**
   - 填写:
     ```
     基础 URL: http://your-server:3000/caldav
     用户名: 您的 z7Note 用户名
     密码: 您的 z7Note 密码
     ```
   - 点击 **创建账户**

### 4. Windows 10/11

#### Outlook Calendar

**注意**: Outlook 不直接支持 CalDAV，需要使用同步工具。

**推荐方案 - Thunderbird**

1. 下载并安装 [Thunderbird](https://www.thunderbird.net/)
2. 安装 **Lightning** 扩展（日历功能）
3. **事件** → **设置** → **账户** → **添加账户**
4. 选择 **配置手动**
5. 填写 CalDAV 信息：
   ```
   用户名: 您的 z7Note 用户名
   URL: http://your-server:3000/caldav
   ```
6. 点击 **继续** → **完成**

### 5. Linux

#### GNOME Calendar

1. 打开 **设置** → **在线账户**
2. 点击 **+** → **其他**
3. 选择 **CalDAV**
4. 填写信息：
   ```
   用户名: 您的 z7Note 用户名
   URL: http://your-server:3000/caldav
   ```
5. 点击 **连接**

#### Evolution

1. 打开 Evolution
2. **文件** → **新建** → **日历**
3. 选择 **CalDAV**
4. 填写信息：
   ```
   用户名: 您的 z7Note 用户名
   URL: http://your-server:3000/caldav
   ```
5. 点击 **查找日历** → **使用** → **关闭**

#### KOrganizer (KDE)

1. 打开 KOrganizer
2. **设置** → **配置 KOrganizer**
3. **日历** → **添加** → **日历文件**
4. 选择 **远程日历** → **CalDAV**
5. 填写 URL 和凭证

---

## 🌐 服务器配置

### 检查服务器状态

```bash
# 检查服务是否运行
docker-compose ps

# 查看日志
docker-compose logs -f

# 测试健康检查
curl http://localhost:3000/health
```

### 查看 CalDAV 日志

```bash
docker-compose logs -f | grep -i caldav
```

### 重启服务

```bash
docker-compose restart
```

---

## 🔧 故障排除

### 问题 1: 无法连接到服务器

**检查清单**:
- [ ] 服务器是否运行：`curl http://your-server:3000/health`
- [ ] 网络是否可达：`ping your-server`
- [ ] 防火墙是否开放端口 3000
- [ ] Docker 容器端口映射是否正确

### 问题 2: 认证失败

**检查步骤**:
1. 确认用户名和密码正确（Web 界面登录使用的密码）
2. 在 Web 界面登录一次，确保账户正常
3. 检查密码是否包含特殊字符（某些客户端不支持）

**测试认证**:
```bash
curl -v -X PROPFIND http://your-server:3000/caldav/your-username \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  -H "Depth: 0"
```

### 问题 3: SSL 证书问题

**iOS/macOS 解决方案**:
1. 在 Safari 中访问服务器地址
2. 下载并安装证书
3. 在 **证书信任设置** 中启用完全信任

**Android 解决方案**:
1. 下载证书文件
2. **设置** → **安全** → **加密与凭据** → **从存储设备安装**
3. 安装并信任证书

### 问题 4: 同步失败或不同步

**排查步骤**:
1. **手动刷新**:
   - iOS/macOS: 下拉日历刷新
   - Android: 下拉或使用刷新按钮

2. **重新添加账户**:
   - 删除 CalDAV 账户
   - 重新添加账户信息

3. **检查服务器日志**:
   ```bash
   docker-compose logs -f | grep -i caldav
   ```

4. **测试 CalDAV 端点**:
   ```bash
   # 测试 OPTIONS
   curl -X OPTIONS http://your-server:3000/caldav/
   
   # 测试 GET (获取日历)
   curl http://your-server:3000/caldav/your-username \
     -H "Authorization: Basic $(echo -n 'username:password' | base64)"
   ```

### 问题 5: 事件/待办不显示

**检查**:
1. 确认已选中正确的日历（z7Note 日历）
2. 在 Web 界面中确认事件/待办已创建
3. 尝试手动同步
4. 检查客户端是否支持对应功能（待办/提醒事项）

---

## 📊 客户端兼容性

| 客户端 | 平台 | 日历 | 待办 | 备注 |
|--------|------|------|------|------|
| iOS 日历 | iOS/iPadOS | ✅ | ✅ | 需要正确配置 SSL |
| iOS 提醒事项 | iOS/iPadOS | - | ✅ | 使用相同 CalDAV 账户 |
| macOS 日历 | macOS | ✅ | ✅ | 原生支持 |
| macOS 提醒事项 | macOS | - | ✅ | 原生支持 |
| Google Calendar | Android | ✅ | ⚠️ | 部分支持 |
| Etar | Android | ✅ | ❌ | 仅日历 |
| DAVx⁵ | Android | ✅ | ✅ | 需配合其他应用 |
| Thunderbird | Windows/Linux | ✅ | ✅ | 需要 Lightning 扩展 |
| GNOME Calendar | Linux | ✅ | ❌ | 仅日历 |
| Evolution | Linux | ✅ | ✅ | 原生支持 |
| Outlook | Windows | ❌ | ❌ | 不支持 CalDAV |

---

## 🎨 高级配置

### 使用反向代理 (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /caldav/ {
        proxy_pass http://localhost:3000/caldav/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 支持特殊 HTTP 方法
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

### HTTPS 配置

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /caldav/ {
        proxy_pass http://localhost:3000/caldav/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

---

## 📚 参考资源

- [RFC 4791 - CalDAV 协议](https://tools.ietf.org/html/rfc4791)
- [z7Note 使用文档](CALENDAR_GUIDE.md)
- [SSL 故障排除](SSL_TROUBLESHOOTING.md)
- [iPhone 配置](IPHONE_QUICK_START.md)

---

## 💡 使用建议

1. **首次配置**: 先使用局域网 HTTP 配置测试，确认功能正常后再配置 HTTPS
2. **定期备份**: z7Note 会自动备份数据，但建议定期导出日历数据
3. **多设备同步**: CalDAV 支持多设备同时使用，数据会自动同步
4. **隐私保护**: HTTPS 配置是生产环境的必需配置，保护数据安全

---

**如遇到问题，请检查服务器日志并提供详细信息。** 🔍
