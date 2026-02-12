# iPhone CalDAV SSL 问题修复总结

## 问题描述

iPhone 配置 CalDAV 时提示"无法配置 SSL"，服务器地址：`https://z7note.255556.xyz/caldav/snowfly`

## 问题原因

1. **CalDAV 路由被全局认证中间件拦截**
   - `/caldav/*` 路径没有被添加到公开路径列表
   - 所有请求都被 Cookie 认证中间件拦截

2. **路由路径定义错误**
   - 在 `caldav.js` 中使用了 `${CALDAV_BASE}/*` 路径
   - 但在 `server.js` 中已经使用了 `app.use('/caldav', caldavRoutes)`
   - 导致路径重复，路由无法匹配

## 修复内容

### 1. 修改 `/Users/a33/docker/z7note/src/server.js`

在公开路径列表中添加 `/caldav/` 路径：

```javascript
const publicPaths = [
  '/login.html', '/share.html', '/user.html',
  '/api/register', '/api/login', '/api/forgot-password', '/api/reset-password',
  '/api/send-bind-code', '/api/verify-bind-email',
  '/api/share/public-list', '/api/share/public/', '/api/share/info', '/api/share/attachment', '/api/share/blog-info',
  '/s/', '/health', '/test-backup.html',
  '/favicon.ico', '/css/', '/js/', '/cdn/',
  '/caldav/'  // CalDAV 路由使用 Basic Auth，不需要 Cookie 认证
];
```

### 2. 修改 `/Users/a33/docker/z7note/src/routes/caldav.js`

修复路由路径定义，移除重复的 `/caldav` 前缀：

```javascript
// 修改前
router.options(`${CALDAV_BASE}/*`, (req, res) => { ... });
router.get(`${CALDAV_BASE}/:username`, basicAuthMiddleware, async (req, res) => { ... });
router.propfind(`${CALDAV_BASE}/:username`, basicAuthMiddleware, async (req, res) => { ... });
router.report(`${CALDAV_BASE}/:username`, basicAuthMiddleware, async (req, res) => { ... });
router.put(`${CALDAV_BASE}/:username/:type/:id`, basicAuthMiddleware, async (req, res) => { ... });
router.delete(`${CALDAV_BASE}/:username/:type/:id`, basicAuthMiddleware, async (req, res) => { ... });

// 修改后
router.options('*', (req, res) => { ... });
router.get('/:username', basicAuthMiddleware, async (req, res) => { ... });
router.propfind('/:username', basicAuthMiddleware, async (req, res) => { ... });
router.report('/:username', basicAuthMiddleware, async (req, res) => { ... });
router.put('/:username/:type/:id', basicAuthMiddleware, async (req, res) => { ... });
router.delete('/:username/:type/:id', basicAuthMiddleware, async (req, res) => { ... });
```

### 3. 改进 CORS 响应头

在 OPTIONS 响应中添加更多响应头，提高 iOS 兼容性：

```javascript
res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Depth, Prefer, X-Requested-With');
res.setHeader('Access-Control-Allow-Credentials', 'true');
```

## 验证结果

### 测试 1：OPTIONS 请求

```bash
curl -v -X OPTIONS https://z7note.255556.xyz/caldav/
```

**结果：** ✅ 成功
- HTTP/1.1 200 OK
- DAV: 1, 2, 3, calendar-access, ...
- Allow: OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR
- Access-Control-Allow-Origin: *
- Access-Control-Allow-Methods: OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR

### 测试 2：SSL 证书

```bash
curl -v https://z7note.255556.xyz/caldav/
```

**结果：** ✅ 成功
- SSL connection using TLSv1.3 / AEAD-AES256-GCM-SHA384
- SSL certificate verify ok
- Server certificate: CN=255556.xyz
- Issuer: C=US; O=Let's Encrypt; CN=E7
- subjectAltName: host "z7note.255556.xyz" matched cert's "*.255556.xyz"

## iPhone 配置步骤

### 使用 HTTPS（推荐）

1. 打开 iPhone "设置" → "日历" → "账户" → "添加账户" → "其他"
2. 选择 "CalDAV 账户"
3. 输入以下信息：
   - **服务器地址**: `https://z7note.255556.xyz/caldav`
   - **用户名**: `snowfly`
   - **密码**: 您的 z7Note 密码
4. 点击 "下一步"
5. 选择要同步的内容（日历、提醒事项）
6. 点击 "保存"

### 使用 HTTP（仅测试）

如果仍然遇到 SSL 问题，可以临时使用 HTTP：

1. 打开 iPhone "设置" → "日历" → "账户" → "添加账户" → "其他"
2. 选择 "CalDAV 账户"
3. 输入以下信息：
   - **服务器地址**: `http://z7note.255556.xyz:3000/caldav`
   - **用户名**: `snowfly`
   - **密码**: 您的 z7Note 密码
4. 点击 "下一步"
5. 选择要同步的内容（日历、提醒事项）
6. 点击 "保存"

**注意：** HTTP 不安全，仅用于测试，生产环境请使用 HTTPS。

## 测试脚本

已创建测试脚本 `/Users/a33/docker/z7note/test-iphone-caldav.sh`，用于测试 CalDAV 功能：

```bash
./test-iphone-caldav.sh
```

## 文档更新

已更新以下文档：

1. **CALDAV.md** - 添加详细的 iPhone 配置说明和故障排除指南
2. **test-iphone-caldav.sh** - 创建 iPhone CalDAV 测试脚本
3. **IPHONE_CALDAV_FIX.md** - 本文档

## 故障排除

如果 iPhone 仍然提示 SSL 错误：

### 1. 检查 SSL 证书

```bash
# 测试 SSL 连接
curl -v https://z7note.255556.xyz/caldav/

# 检查证书链
openssl s_client -connect z7note.255556.xyz:443 -servername z7note.255556.xyz
```

### 2. 检查服务器时间

```bash
date
```

确保服务器时间准确，SSL 证书验证依赖于正确的时间。

### 3. 检查 nginx 配置

确保 nginx 配置使用完整的证书链：

```nginx
ssl_certificate /path/to/fullchain.pem;  # 包含证书和中间证书
ssl_certificate_key /path/to/privkey.pem;
```

### 4. 查看服务器日志

```bash
docker-compose logs -f | grep -i caldav
```

### 5. 重启服务

```bash
docker-compose restart
```

## 常见错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| 401 | 认证失败 | 检查用户名和密码 |
| 403 | 权限不足 | 确认用户名正确 |
| 404 | 路由不存在 | 检查服务器地址 |
| 500 | 服务器错误 | 查看服务器日志 |
| 502 | 网关错误 | 检查 nginx 配置 |
| 503 | 服务不可用 | 重启服务 |

## 技术细节

### CalDAV 协议支持

- ✅ OPTIONS（CORS 预检）
- ✅ PROPFIND（读取资源属性）
- ✅ REPORT（查询日历数据）
- ✅ GET（获取 iCal 数据）
- ✅ PUT（创建/更新事件/待办）
- ✅ DELETE（删除事件/待办）

### 认证方式

- Basic Auth（用户名:密码）
- 使用 bcrypt 验证密码
- 从数据库查询用户信息

### 安全特性

- HTTPS/TLS 1.3 加密
- Let's Encrypt 证书
- 完整的证书链
- CORS 支持
- 安全响应头

## 后续建议

1. **监控 SSL 证书有效期**
   - 设置证书到期提醒
   - 自动续期 Let's Encrypt 证书

2. **添加日志记录**
   - 记录所有 CalDAV 请求
   - 记录认证失败尝试
   - 记录同步错误

3. **性能优化**
   - 添加请求缓存
   - 优化数据库查询
   - 添加请求限流

4. **测试覆盖**
   - 添加自动化测试
   - 测试各种客户端兼容性
   - 测试边界情况

## 相关文件

- `/Users/a33/docker/z7note/src/server.js` - 服务器主文件
- `/Users/a33/docker/z7note/src/routes/caldav.js` - CalDAV 路由实现
- `/Users/a33/docker/z7note/src/middleware/basicAuth.js` - Basic Auth 中间件
- `/Users/a33/docker/z7note/src/utils/icalGenerator.js` - iCal 生成工具
- `/Users/a33/docker/z7note/src/utils/icalParser.js` - iCal 解析工具
- `/Users/a33/docker/z7note/CALDAV.md` - CalDAV 功能文档
- `/Users/a33/docker/z7note/test-iphone-caldav.sh` - iPhone 测试脚本

## 修复完成时间

2026-02-10 11:51 UTC+8

## 验证状态

✅ CalDAV 路由修复完成
✅ SSL 证书验证通过
✅ OPTIONS 请求测试通过
✅ 文档更新完成
✅ 测试脚本创建完成

## 下一步

请在 iPhone 上尝试配置 CalDAV：

1. **服务器地址**: `https://z7note.255556.xyz/caldav`
2. **用户名**: `snowfly`
3. **密码**: 您的 z7Note 密码

如果仍然遇到问题，请查看服务器日志并提供详细的错误信息。
