# z7Note

<div align="center">

**知其种种，记其始末。让种种思绪，归于一处。**

---

一个功能强大的自托管笔记和文件共享平台。

[简体中文](./README.md) | [English](./README_EN.md)

</div>

## ✨ 功能特性

- **📝 Markdown 编辑器**: 基于 CodeMirror 的编辑器，支持实时预览
- **🔐 用户管理**: 支持多用户注册、登录和密码管理
- **🗂️ 文件存储**: 每个用户拥有独立的媒体库，可以上传和管理附件
- **🔗 内容分享**:
  - 将单篇笔记或文件创建为分享链接
  - 支持创建公开分享或私密（密码保护）分享
  - 可为分享链接设置过期时间
- **🌐 个人博客**:
  - 将您的公开笔记聚合为一个个人博客
  - 自定义博客标题、主题和 CSS 样式
- **🚀 管理后台**:
  - 查看所有用户的使用统计（笔记和附件）
  - 管理用户（删除、重置密码、配额调整）
  - 集中查看和管理所有笔记
- **🛡️ 强大的备份机制**:
  - 支持手动或定时（Cron-like）备份
  - 备份模式可选 **增量备份** 或 **全量备份**
  - 备份文件可存储在本地，或自动推送到 **WebDAV** 或发送至指定 **邮箱**

## 🛠️ 技术栈

- **后端**: Node.js, Express.js (模块化 MVC 架构)
- **数据库**: SQLite
- **前端**: Vanilla JavaScript, CodeMirror, Marked.js
- **部署**: Docker, Docker Compose
- **CDN**: 使用 cdnjs 和 jsDelivr 加速静态资源

## 🚀 快速开始

### 单服务器部署

```bash
# 1. 克隆代码
git clone https://github.com/hzx2185/z7Note.git
cd z7Note

# 2. 配置环境变量
cp .env.example .env
vim .env  # 修改配置（可选）

# 3. 设置目录权限（重要！）
chown -R 1001:1001 data/ logs/

# 4. 启动服务
docker-compose up -d

# 5. 完成！访问 http://localhost:3000
```

**注意：**
- 容器以 UID 1001 运行（非 root 用户，提高安全性）
- 必须设置 `data/` 和 `logs/` 目录的权限为 1001:1001
- 如果遇到权限错误，请运行：`chown -R 1001:1001 data/ logs/`

### 本地运行（不使用 Docker）

```bash
# 1. 安装 Node.js
# 2. 安装依赖
npm install

# 3. 配置 .env 文件

# 4. 启动服务
npm start
```

## 🔄 数据备份

### 自动备份配置

z7Note 内置了强大的自动备份功能，支持定时备份、增量备份、WebDAV 和邮件备份。

#### 配置自动备份

1. **登录管理后台**
   - 访问 `http://your-server:3000/admin`
   - 使用管理员账号登录

2. **配置备份设置**
   - 备份模式：增量备份 或 全量备份
   - 备份频率：每天凌晨、每周日凌晨、每6小时、每12小时 或 自定义
   - 保留数量：保留最近的 N 个备份（0 表示不限制）
   - WebDAV URL：可选，自动推送到 WebDAV 存储
   - 通知邮箱：可选，备份完成后发送邮件通知

#### 备份文件说明

- **增量备份**：`z7note-inc-YYYYMMDD-HHMMSS.zip` - 只包含变更的文件
- **全量备份**：`z7note-backup-YYYYMMDD-HHMMSS.zip` - 包含所有数据
- **备份位置**：`data/backups/` 目录

#### 手动备份

```bash
# 方式1：通过管理后台
# 访问 /admin 页面，点击"下载全量"或"下载增量"

# 方式2：备份数据目录
tar -czf backup-$(date +%Y%m%d).tar.gz data/
```

#### 恢复备份

```bash
# 1. 停止服务
docker-compose down

# 2. 解压备份文件
tar -xzf backup-20250101.tar.gz

# 3. 重启服务
docker-compose up -d
```

### 备份策略建议

**单服务器部署：**
- ✅ 启用定时备份（每天凌晨）
- ✅ 启用增量备份（节省空间）
- ✅ 配置 WebDAV 备份（异地存储）
- ✅ 配置邮件通知（备份状态提醒）

**多服务器部署：**
- 每台服务器独立备份
- 定期手动同步备份文件
- 或者使用数据库复制工具

## 🔧 常用命令

### Docker Compose 命令

```bash
# 启动服务
docker-compose up -d

# 停止服务
docker-compose stop

# 重启服务
docker-compose restart

# 查看日志
docker-compose logs -f

# 查看服务状态
docker-compose ps

# 更新代码
git pull origin main
docker-compose up -d --build

# 备份数据
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# 恢复数据
tar -xzf backup-20250101.tar.gz
docker-compose restart
```

## ⚙️ 环境变量配置 (.env)

```bash
# 服务器配置
PORT=3000              # 端口号
HOST=0.0.0.0           # 监听地址

# 配额配置（MB）
DEFAULT_NOTE_LIMIT=10  # 默认笔记配额
DEFAULT_FILE_LIMIT=50   # 默认附件配额
MAX_FILE_SIZE=500      # 最大文件大小

# 管理员配置
ADMIN_USER=admin        # 管理员用户名

# SMTP 配置（可选）
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-password
```

## 📁 目录结构

```
.
├── data/               # 数据目录 (数据库, 上传的文件, 备份)
│   ├── z7note.db       # SQLite 数据库文件
│   ├── uploads/        # 用户上传的文件
│   └── backups/        # 备份文件
├── public/             # 静态前端文件 (HTML, CSS, JS)
│   ├── css/            # 样式文件
│   ├── js/             # JavaScript 模块
│   ├── cdn/            # CDN 资源
│   └── *.html          # 页面模板
├── src/                # 后端源代码 (MVC 架构)
│   ├── server.js       # Express 主入口
│   ├── config/         # 配置管理
│   ├── db/             # 数据库连接
│   ├── routes/         # API 路由
│   ├── middleware/     # 中间件
│   ├── services/       # 业务服务
│   └── utils/          # 工具函数
├── .env                # 环境变量配置文件 (需自行创建)
├── .env.example        # 环境变量示例
├── package.json        # Node.js 项目配置
├── Dockerfile          # Docker 镜像定义
└── docker-compose.yml  # Docker Compose 部署配置
```

## ❓ 常见问题

### Q: 需要注册 Docker 账号吗？
**A: 不需要！** 使用本地构建，无需任何账号。

### Q: 如何修改端口？
**A:** 编辑 `.env` 文件，修改 `PORT=3000` 为你想要的端口，然后重启：
```bash
docker-compose restart
```

### Q: 如何备份数据？
**A:** 运行备份脚本：
```bash
tar -czf backup-$(date +%Y%m%d).tar.gz data/
```

### Q: 如何更新应用？
**A:** 运行更新命令：
```bash
git pull origin main
docker-compose up -d --build
```

### Q: 数据库在哪里？
**A:** 在 `data/z7note.db` 文件中。

### Q: 上传的文件在哪里？
**A:** 在 `data/uploads/` 目录中。

### Q: 如何配置 HTTPS？
**A:** 使用 Nginx 反向代理 + Let's Encrypt：
```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 📊 Docker 镜像信息

- **镜像大小**: 305MB
- **基础镜像**: node:20-alpine
- **构建方式**: 多阶段构建
- **安全特性**: 非 root 用户运行

## 🔗 相关链接

- **官方网站**: https://www.z7zz.com
- **GitHub 仓库**: https://github.com/hzx2185/z7Note
- **问题反馈**: https://github.com/hzx2185/z7Note/issues

## 📝 注意事项

1. **首次启动需要几分钟** - 需要下载依赖和构建镜像
2. **确保端口 3000 未被占用** - 或修改 `.env` 中的端口
3. **定期备份数据** - 使用 `tar -czf backup-$(date +%Y%m%d).tar.gz data/`
4. **查看日志排查问题** - 使用 `docker-compose logs -f`

## 🔧 故障排除

### 权限错误

如果遇到 `EACCES: permission denied` 错误：

```bash
# 停止容器
docker-compose down

# 修复目录权限
chown -R 1001:1001 data/ logs/

# 重新启动
docker-compose up -d
```

### 容器无法启动

```bash
# 查看容器日志
docker-compose logs -f

# 检查容器状态
docker-compose ps

# 重新构建镜像
docker-compose up -d --build
```

### 端口被占用

```bash
# 查看端口占用
lsof -i :3000

# 修改 .env 中的端口
PORT=3001

# 重启容器
docker-compose restart
```

---

**z7Note** - *知其种种，记其始末。*
