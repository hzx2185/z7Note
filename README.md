# z7Note

<div align="center">

**知其种种，记其始末。让种种思绪，归于一处。**

---

一个功能强大的自托管笔记和文件共享平台。

[简体中文](./README.md) | [English](./README_EN.md)

</div>

## ✨ 功能特性

### 前端用户功能

- **📝 Markdown 编辑器**: 基于 CodeMirror 的编辑器，支持实时预览
  - 支持分屏/编辑/预览三种模式切换
  - 实时同步滚动
  - 代码高亮和行号显示
  - 智能标题解析和分类管理
  - 快捷键支持（F1 查看快捷键）
  - 自动保存到云端

- **🎯 标记功能**: 高效的内容选择和操作
  - 设置标记起始位置（Alt + [）
  - 设置标记结束位置（Alt + ]）
  - 快速选择标记区域
  - 复制/剪切/删除标记区域
  - Escape 清除标记

- **📋 笔记管理**:
  - 快速创建、编辑、删除笔记
  - 按分类/文件夹组织笔记
  - 支持批量操作（批量移动、删除）
  - 搜索笔记内容
  - 回收站功能（恢复/永久删除）

- **🗂️ 附件管理**:
  - 上传并插入附件到笔记
  - 从附件库快速选择插入
  - 支持图片、PDF、音频、视频等多种格式
  - 自动检测无效附件引用
  - 清理未引用的附件
  - 附件使用量统计

- **🔗 内容分享**:
  - 将单篇笔记或文件创建为分享链接
  - 支持创建公开分享或私密（密码保护）分享
  - 可为分享链接设置过期时间
  - 分享管理（查看、撤销、删除）
  - 复制分享链接到剪贴板

- **💾 数据备份**:
  - 手动触发备份
  - 配置 WebDAV 备份
  - 备份状态显示
  - 邮件通知支持
  - 测试连接功能

- **🔐 用户管理**:
  - 用户注册和登录
  - 邮箱绑定（支持邮箱验证码）
  - 修改密码
  - 退出登录

- **🎨 界面特性**:
  - 暗色/亮色主题切换
  - 响应式设计（支持移动端）
  - 统一的状态通知系统
  - 撤销/重做功能
  - 导出/导入笔记数据
  - 快捷工具栏（插入符号、待办事项等）
  - 查找替换功能

### 管理后台功能

- **📊 用户统计**: 查看所有用户的使用情况
- **👥 用户管理**: 删除用户、重置密码、调整配额
- **📝 笔记管理**: 集中查看和管理所有笔记
- **⚙️ 系统配置**: 备份策略、配额设置等

### 其他功能

- **🌐 个人博客**: 将公开笔记聚合为个人博客
- **🛡️ 自动备份**: 支持定时备份、增量备份、WebDAV 和邮箱备份

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

## ⌨️ 前端快捷键

### 编辑器快捷键

- `F1` - 显示快捷键帮助
- `Ctrl/Cmd + Z` - 撤销
- `Ctrl/Cmd + Y` 或 `Ctrl/Cmd + Shift + Z` - 重做
- `Ctrl/Cmd + B` - 切换侧边栏
- `Ctrl/Cmd + A` - 全选
- `Ctrl/Cmd + C` - 复制
- `Ctrl/Cmd + X` - 剪切
- `Ctrl/Cmd + V` - 粘贴
- `Ctrl/Cmd + F` - 查找

### 标记功能快捷键

- `Alt + [` - 设置标记起始位置
- `Alt + ]` - 设置标记结束位置
- `Ctrl/Cmd + Shift + C` - 复制标记区域
- `Ctrl/Cmd + Shift + X` - 剪切标记区域
- `Ctrl/Cmd + Shift + D` - 删除标记区域
- `Escape` - 清除标记

## 🔴 状态指示灯

左上角的状态灯显示当前操作状态：

- **灰色** (⚪) - 就绪
- **蓝色闪烁** (🔵) - 工作中（正在保存、加载等）
- **绿色** (🟢) - 操作成功（已保存、已删除等）
- **红色** (🔴) - 操作失败（保存失败、网络错误等）
- **橙色** (🟠) - 警告（配置问题、操作提示等）

所有操作提示都会统一显示在状态灯右侧的文字位置，3秒后自动恢复为"就绪"。

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

### Q: 如何使用标记功能？
**A:** 标记功能可以快速选择和操作特定文本内容：
1. 将光标移动到起始位置，按 `Alt + [` 设置标记起
2. 将光标移动到结束位置，按 `Alt + ]` 设置标记终
3. 此时已选中的区域会被高亮
4. 按 `Escape` 可清除标记

### Q: 状态灯显示什么？
**A:** 状态灯显示当前操作状态：
- 灰色：就绪，可以编辑
- 蓝色闪烁：正在执行操作（如保存、加载）
- 绿色：操作成功完成
- 红色：操作失败
- 橙色：警告或提示

### Q: 如何批量操作笔记？
**A:** 在侧边栏点击"批量"按钮进入批量模式：
- 点击笔记前的复选框选择笔记
- 点击"移动"可移动选中的笔记到其他分类
- 点击"删除"可批量删除笔记
- 点击"取消"退出批量模式

### Q: 如何管理附件？
**A:** 点击编辑器工具栏的"📂"按钮打开附件管理器：
- 支持上传文件到附件库
- 从附件库快速插入到笔记中
- 检测和清理无效的附件引用
- 查看附件使用量统计

### Q: 如何分享笔记？
**A:** 方式1：在笔记列表中点击分享按钮
方式2：在笔记内容中点击分享链接
支持公开分享和密码保护分享，可设置过期时间。

### Q: 如何备份数据到 WebDAV？
**A:** 在侧边栏点击"备份"按钮：
1. 勾选"启用自动备份"
2. 配置 WebDAV URL、用户名、密码
3. 点击"测试连接"验证配置
4. 点击"保存配置"
5. 点击"立即备份"可手动触发备份

### Q: 如何切换主题？
**A:** 点击顶部工具栏的"🌓"按钮切换暗色/亮色主题。

### Q: 如何查看快捷键？
**A:** 按 `F1` 键或点击顶部工具栏的"⌨️"按钮查看所有快捷键。

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
