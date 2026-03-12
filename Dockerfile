# 多阶段构建 - 构建阶段
FROM node:20-alpine AS builder

# 安装构建依赖
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装所有依赖
RUN npm ci --prefer-offline --no-audit || npm ci

# 复制源码
COPY . .

# 运行阶段 - 使用alpine基础镜像
FROM node:20-alpine

# 安装运行时依赖
# 添加 su-exec 用户权限切换工具
RUN apk add --no-cache sqlite tzdata su-exec

WORKDIR /app

# 从构建阶段复制依赖和源码
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/docker-entrypoint.sh ./

# 赋予脚本执行权限
RUN chmod +x /app/docker-entrypoint.sh

# 创建非root用户
RUN addgroup -g 1001 -S appuser && \
    adduser -S -D -H -u 1001 -s /sbin/nologin -G appuser -g appuser appuser

# 创建数据目录并预设权限
RUN mkdir -p data/uploads data/backups logs && \
    chown -R 1001:1001 /app

# 暴露端口
EXPOSE 80

# 🔴 关键点：不再在 Dockerfile 中写 USER appuser，因为脚本需要 root 权限去 chown
# 但脚本最后会通过 su-exec 自动切换到 appuser (1001)

# 入口点配置
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# 默认启动命令
CMD ["node", "src/server.js"]

# 健康检查 (使用 curl 或 node 自检)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:80/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"
