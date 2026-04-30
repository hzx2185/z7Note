# z7Note - Docker 镜像使用说明

[简体中文] 知其种种，记其始末。一个基于 Node.js 和 SQLite 的全功能个人效率平台。
[English] A full-featured personal productivity platform built with Node.js and SQLite.

---

## ✨ 核心功能 / Features

- **📝 笔记管理**: 专业 Markdown 编辑器（CodeMirror），全文搜索，回收站
- **🗂️ 文件管理**: 大文件分片上传，图片自动压缩，附件实时预览
- **📅 日历功能**: 农历支持，ICS 订阅，农历重复提醒
- **🤝 数据同步**: 原生 CalDAV 日历与 CardDAV 联系人同步
- **📁 WebDAV**: WebDAV 支持，兼容 Obsidian 插件同步
- **💾 数据备份**: 多目的地备份（WebDAV、邮件、本地）
- **🔐 安全特性**: 双因素认证，会话安全，防护 CSRF/XSS

---

## 🛠️ 镜像信息

- **镜像名称**: `hzx2185/z7note:latest`
- **基础镜像**: `node:20-alpine`
- **镜像大小**: 约 305MB
- **安全特性**: 非 root 用户运行（UID 1001），自动修复挂载权限
- **构建优化**: 多阶段生产级构建

---

## 🚀 快速开始

### 使用 Docker Compose（推荐）

```bash
# 1. 创建 docker-compose.yml 文件
cat > docker-compose.yml << 'EOF'
services:
  z7note-app:
    image: hzx2185/z7note:latest
    container_name: z7note
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    ports:
      - "3000:80"
    restart: unless-stopped
    environment:
      - TZ=Asia/Shanghai
      - JWT_SECRET=please-change-this-long-random-secret
      - ADMIN_USER=admin
      - ADMIN_REGISTRATION_TOKEN=please-change-this-admin-bootstrap-token
EOF

# 2. 设置目录权限
mkdir -p data logs
chown -R 1001:1001 data/ logs/

# 3. 启动服务
docker-compose up -d

# 4. 访问应用
open http://localhost:3000
```

### 使用 Docker 命令

```bash
# 1. 创建数据目录
mkdir -p data logs
chown -R 1001:1001 data/ logs/

# 2. 启动容器
docker run -d \
  --name z7note \
  -p 3000:80 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  -e TZ=Asia/Shanghai \
  -e JWT_SECRET=please-change-this-long-random-secret \
  -e ADMIN_USER=admin \
  -e ADMIN_REGISTRATION_TOKEN=please-change-this-admin-bootstrap-token \
  --restart unless-stopped \
  hzx2185/z7note:latest

# 3. 访问应用
open http://localhost:3000
```

## 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `TZ` | `Asia/Shanghai` | 时区设置 |
| `PORT` | `80` | 容器内端口（通常不需要修改） |
| `HOST` | `0.0.0.0` | 容器内监听地址 |
| `ADMIN_USER` | `admin` | 管理员用户名（多个用逗号分隔） |
| `ADMIN_REGISTRATION_TOKEN` | - | 管理员初始化令牌，生产环境必填，注册 `ADMIN_USER` 时需要提供 |
| `JWT_SECRET` | - | JWT 签名密钥，生产环境必填 |
| `DB_DIALECT` | `sqlite` | 数据库方言，当前仅支持 `sqlite` |
| `DEFAULT_NOTE_LIMIT` | `100` | 默认笔记空间配额，单位 MB |
| `DEFAULT_FILE_LIMIT` | `500` | 默认附件空间配额，单位 MB |
| `MAX_FILE_SIZE` | `500` | 单文件上传限制，单位 MB |
| `CALDAV_ENABLED` | `true` | 是否启用 CalDAV 日历同步 |
| `CARDDAV_ENABLED` | `true` | 是否启用 CardDAV 通讯录同步 |
| `DAILY_BACKUP_LIMIT` | `0` | 用户每日备份次数限制，0 表示不限制 |
| `LOG_LEVEL` | `INFO` | 日志级别：DEBUG / INFO / WARN / ERROR |
| `LOG_MAX_FILE_SIZE_MB` | `100` | 应用日志单文件轮转大小 |
| `LOG_MAX_ARCHIVES` | `5` | 应用日志保留归档数量 |
| `PROTOCOL_DEBUG_LOGS` | `false` | 是否输出 WebDAV / CalDAV / CardDAV 协议调试日志 |

### 数据卷

| 路径 | 说明 |
|------|------|
| `/app/data` | 数据目录（数据库、上传文件、备份等） |
| `/app/logs` | 日志目录 |

### 端口映射

- 容器内端口：`80`
- 建议映射端口：`3000`（可根据需要修改）

## 初始配置

### 1. 生产环境必填项

生产部署前建议先准备两个随机值：

```bash
openssl rand -hex 32
```

然后写入 `docker-compose.yml`：

```yaml
environment:
  - TZ=Asia/Shanghai
  - JWT_SECRET=替换为随机长字符串
  - ADMIN_USER=admin
  - ADMIN_REGISTRATION_TOKEN=替换为一次性管理员初始化令牌
```

`JWT_SECRET` 用于签名登录令牌；`ADMIN_REGISTRATION_TOKEN` 用于保护首次管理员注册。不要在公开仓库提交真实值。

### 2. 创建管理员账户

部署前请先确认管理员用户名配置：
- 默认值为 `admin`
- 可通过 `ADMIN_USER` 修改（支持多个用户名，逗号分隔）
- 生产环境必须同时设置 `ADMIN_REGISTRATION_TOKEN`

首次注册时，与 `ADMIN_USER` 中某个用户名完全匹配的账户会拥有管理员权限；生产环境还必须提供管理员初始化令牌：
- 访问 `http://localhost:3000`
- 点击"注册"按钮
- 使用预先配置好的管理员用户名完成注册
- 在“管理员初始化令牌”输入框中填写 `ADMIN_REGISTRATION_TOKEN`

### 3. 配置 SMTP 邮件服务

**重要：SMTP 配置已迁移到管理后台数据库存储**

1. 登录管理员账户
2. 访问管理后台：`http://localhost:3000/admin`
3. 在侧边栏找到 **"SMTP 邮件配置"** 区域
4. 填写配置信息：
   - **SMTP 服务器**：如 `smtp.163.com`
   - **端口**：`465`（SSL）或 `587`（STARTTLS）
   - **SSL/TLS**：根据端口选择
   - **用户名**：完整邮箱地址
   - **密码**：邮箱授权码（不是邮箱密码）
5. 点击 **"保存"** 按钮
6. 点击 **"测试"** 按钮验证配置

**常用邮箱 SMTP 配置：**

| 邮箱服务 | SMTP 服务器 | 端口 | SSL/TLS |
|---------|------------|------|---------|
| 163 邮箱 | smtp.163.com | 465 | 启用 |
| QQ 邮箱 | smtp.qq.com | 465 | 启用 |
| Gmail | smtp.gmail.com | 587 | 启用 |
| Outlook | smtp.office365.com | 587 | 启用 |

## 数据持久化

### 数据目录结构

```
data/
├── z7note.db           # SQLite 数据库
├── uploads/            # 用户上传的文件
├── backups/            # 系统备份文件
├── cdn-cache/          # CDN 缓存
└── upload_chunks/      # 分片上传临时文件
```

### 备份数据

```bash
# 方式 1：备份整个 data 目录
tar -czf z7note-backup-$(date +%Y%m%d).tar.gz data/

# 方式 2：只备份数据库
cp data/z7note.db z7note-backup-$(date +%Y%m%d).db
```

### 恢复数据

```bash
# 1. 停止容器
docker-compose down

# 2. 恢复数据
tar -xzf z7note-backup-20260312.tar.gz

# 3. 修复权限
chown -R 1001:1001 data/ logs/

# 4. 重启容器
docker-compose up -d
```

## 更新镜像

```bash
# 1. 拉取最新镜像
docker pull hzx2185/z7note:latest

# 2. 停止并删除旧容器
docker-compose down

# 3. 启动新容器
docker-compose up -d

# 4. 查看日志确认启动成功
docker-compose logs -f
```

## DAV 客户端配置

z7Note 暴露三个同步入口，均使用 z7Note 用户名和密码登录：

| 协议 | 地址 | 用途 |
|------|------|------|
| WebDAV | `https://your-domain.com/webdav/` | 笔记 Markdown 文件与附件同步 |
| CalDAV | `https://your-domain.com/caldav/` | 日历事件与待办同步 |
| CardDAV | `https://your-domain.com/carddav/` | 系统通讯录同步 |

### iPhone / macOS 通讯录

1. 设置 > 通讯录 > 账户 > 添加账户 > 其他
2. 选择“添加 CardDAV 账户”
3. 服务器填写你的域名或 `https://your-domain.com/carddav/`
4. 输入 z7Note 用户名和密码
5. 保存后等待系统通讯录同步

当前版本已兼容 iOS / macOS 通讯录写入的 Apple 分组字段，例如 `item1.TEL;type=pref:13800000000`，可以正常同步电话号码。

## 故障排查

### 权限错误

```bash
# 修复数据目录权限
chown -R 1001:1001 data/ logs/
```

### 端口被占用

```bash
# 查看端口占用
lsof -i :3000

# 修改 docker-compose.yml 中的端口映射
ports:
  - "3001:80"  # 改为其他端口
```

### 查看日志

```bash
# 查看容器日志
docker-compose logs -f

# 查看应用日志
tail -f logs/app-*.log
```

### 清理旧日志和缓存

日志和缓存属于运行数据，建议按需清理，不要删除数据库和上传目录：

```bash
# 删除 30 天前的应用日志
find logs -name 'app-*.log' -mtime +30 -delete

# 清理 CDN 缓存，后续访问会自动重建
rm -rf data/cdn-cache/*

# 查看数据目录体积
du -sh data/* logs/*
```

### 重启容器

```bash
# 重启容器
docker-compose restart

# 完全重建
docker-compose down
docker-compose up -d
```

## 安全建议

1. **定期备份数据** - 使用管理后台的自动备份功能
2. **更换默认端口** - 修改 docker-compose.yml 中的端口映射
3. **使用 HTTPS** - 配置反向代理（Nginx + Let's Encrypt）
4. **定期更新镜像** - 获取最新的安全修复
5. **保护管理后台** - 使用强密码，启用双因素认证

---

## 🔗 相关链接

- **GitHub 仓库**: https://github.com/hzx2185/z7Note
- **问题反馈**: https://github.com/hzx2185/z7Note/issues

---

**z7Note** - *知其种种，记其始末。Capture every thought, preserve every detail.*
