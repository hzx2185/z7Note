# 日历功能使用指南

## 📅 功能概述

z7Note 的日历功能提供了完整的待办事项和事件管理能力，支持：

- **月/周/日视图切换**
- **待办事项管理**（支持优先级、截止日期）
- **事件管理**（支持全天事件、时间段事件）
- **当日笔记关联**
- **CalDAV 同步**（支持与系统日历应用同步）

## 🌐 访问方式

### Web 界面

登录后点击主页的"日历"按钮，或直接访问：
```
http://your-server:3000/calendar.html
```

### CalDAV 同步

#### iPhone/iPad 配置

由于 iOS 系统对 SSL 证书的严格要求，推荐使用以下两种方式之一：

**方式 1：局域网 HTTP 配置（推荐用于测试）**

1. 确保 iPhone 和服务器在同一局域网
2. 在 iPhone 上打开 **设置** → **日历** → **账户** → **添加账户** → **其他**
3. 选择 **CalDAV 账户**
4. 填写以下信息：
   - **服务器**: `http://服务器IP:3000/caldav`（例如：`http://192.168.1.100:3000/caldav`）
   - **用户名**: 您的 z7Note 用户名
   - **密码**: 您的 z7Note 密码
5. 点击 **下一步** → 选择要同步的内容 → **保存**

**方式 2：HTTPS 配置（推荐用于生产环境）**

1. 确保服务器已配置 SSL 证书
2. 在 iPhone 上访问 `https://your-domain.com`
3. 如果出现证书警告，手动信任证书：
   - 打开 **设置** → **通用** → **关于本机** → **证书信任设置**
   - 找到证书，启用"针对根证书启用完全信任"
4. 按方式 1 的步骤配置 CalDAV，使用 HTTPS 地址：
   - **服务器**: `https://your-domain.com/caldav`

#### macOS 配置

1. 打开 **日历** 应用
2. **日历** → **设置** → **账户** → **+** → **其他 CalDAV 账户**
3. 填写：
   - **账户类型**: **高级**
   - **服务器地址**: `http://your-server:3000/caldav` 或 `https://your-domain.com/caldav`
   - **端口**: `3000`（HTTP）或 `443`（HTTPS）
   - **用户名**: 您的 z7Note 用户名
   - **密码**: 您的 z7Note 密码
4. 点击 **登录**

#### Android 配置

1. 打开 **设置** → **账户** → **添加账户** → **CalDAV**
2. 填写服务器地址和凭证
3. 完成配置

## 📱 Web 界面使用

### 基本操作

1. **查看日期**: 点击日历中的任意日期
2. **切换视图**: 点击顶部的"月/周/日"按钮
3. **导航日期**: 使用"上月/下月"按钮或点击"今天"

### 添加待办事项

1. 点击侧边栏的"+ 添加"按钮
2. 填写待办信息：
   - **标题**: 待办事项的名称
   - **描述**: 详细描述（可选）
   - **优先级**: 低/中/高
   - **截止日期**: 选择日期（可选）
3. 点击"保存"

### 添加事件

1. 点击顶部的"新建"按钮
2. 填写事件信息：
   - **标题**: 事件的名称
   - **描述**: 详细描述（可选）
   - **开始时间**: 选择日期和时间
   - **结束时间**: 选择日期和时间（可选）
   - **全天事件**: 勾选表示全天事件
   - **颜色**: 选择事件显示颜色
3. 点击"保存"

### 查看当日笔记

选中日期后，侧边栏会显示当日修改的笔记列表。点击笔记标题可以在新标签页中打开。

## 🔧 CalDAV API 说明

### 端点列表

#### OPTIONS 请求

```bash
curl -X OPTIONS http://your-server:3000/caldav/
```

**响应头**:
- `DAV: 1, 2, 3, calendar-access, calendar-auto-schedule, calendar-query, calendar-multiget, calendar-availability, calendar-proxy`
- `Allow: OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR`

#### PROPFIND 请求

```bash
curl -X PROPFIND http://your-server:3000/caldav/username \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  -H "Depth: 0"
```

**返回**: XML 格式的日历属性

#### GET 请求（获取 iCal 格式）

```bash
curl http://your-server:3000/caldav/username \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)"
```

**返回**: text/calendar 格式的日历数据

### 认证方式

CalDAV 使用 HTTP Basic Auth 认证：

```
Authorization: Basic base64(username:password)
```

## 🛠️ 故障排除

### 问题 1: iPhone 提示"无法使用SSL连接"

**解决方案**:

1. **使用局域网 HTTP 配置**（最简单）
   - 确保设备和服务器在同一网络
   - 使用 `http://server-ip:3000/caldav` 配置

2. **手动信任证书**（HTTPS）
   - 在 Safari 中访问服务器地址
   - 安装并信任证书
   - 在 **设置** → **通用** → **关于本机** → **证书信任设置** 中启用完全信任

3. **升级 iOS 系统**
   - iOS 12.2+ 完整支持 Let's Encrypt 证书
   - iOS 9-11 可能不支持某些证书类型

### 问题 2: CalDAV 同步失败

**检查步骤**:

1. **验证服务器连接**:
   ```bash
   curl http://your-server:3000/health
   ```

2. **检查 CalDAV OPTIONS**:
   ```bash
   curl -X OPTIONS http://your-server:3000/caldav/
   ```

3. **验证凭证**:
   ```bash
   curl -X PROPFIND http://your-server:3000/caldav/your-username \
     -H "Authorization: Basic $(echo -n 'username:password' | base64)"
   ```

4. **查看服务器日志**:
   ```bash
   docker-compose logs -f | grep -i caldav
   ```

### 问题 3: 事件/待办不显示

**检查**:

1. 确认已选中正确的日期
2. 刷新浏览器页面
3. 检查浏览器控制台是否有错误信息
4. 确认 API 请求返回了数据

### 问题 4: 模态框无法打开

**解决方案**:

1. 清除浏览器缓存
2. 检查是否有 JavaScript 错误
3. 尝试使用无痕/隐私浏览模式

## 📋 测试命令

```bash
# 1. 健康检查
curl http://your-server:3000/health

# 2. 测试 CalDAV OPTIONS
curl -X OPTIONS http://your-server:3000/caldav/

# 3. 测试 CalDAV PROPFIND
curl -X PROPFIND http://your-server:3000/caldav/username \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  -H "Depth: 0"

# 4. 获取 iCal 格式数据
curl http://your-server:3000/caldav/username \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)"

# 5. 查看服务器日志
docker-compose logs -f | grep -i caldav
```

## 🔐 安全建议

1. **生产环境必须使用 HTTPS**
   - 使用反向代理（如 Nginx）
   - 配置有效的 SSL 证书

2. **局域网配置仅用于测试**
   - 不要在公共网络中使用 HTTP CalDAV
   - 限制对 CalDAV 端点的访问

3. **定期更新密码**
   - 定期更换 z7Note 账户密码
   - 启用双因素认证（如果可用）

## 📚 相关文档

- **SSL 故障排除**: `SSL_TROUBLESHOOTING.md`
- **iPhone 配置**: `IPHONE_QUICK_START.md`
- **CalDAV 协议**: `CALDAV.md`

## 💡 使用技巧

1. **快捷键**:
   - `T`: 今天
   - `←/→`: 上月/下月
   - `Esc`: 关闭模态框

2. **批量操作**:
   - 点击复选框快速完成待办
   - 悬停显示删除按钮

3. **响应式设计**:
   - 桌面端显示月视图
   - 平板端显示周视图
   - 手机端显示日视图

---

**享受您的日历体验！** 🎉
