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
RUN apk add --no-cache sqlite

WORKDIR /app

# 从构建阶段复制依赖和源码
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public

# 清理不必要的文件
RUN rm -rf node_modules/.cache \
    node_modules/.npm \
    node_modules/.yarn-integrity \
    && find node_modules -name "*.md" -delete \
    && find node_modules -name "*.txt" -delete \
    && find node_modules -name "LICENSE" -delete \
    && find node_modules -name "LICENSE.*" -delete \
    && find node_modules -name "CHANGELOG*" -delete \
    && find node_modules -name "AUTHORS" -delete \
    && find node_modules -name "CONTRIBUTORS" -delete \
    && find node_modules -name "Makefile" -delete \
    && find node_modules -name "Gulpfile*" -delete \
    && find node_modules -name "Gruntfile*" -delete \
    && find node_modules -name ".eslintrc*" -delete \
    && find node_modules -name ".prettierrc*" -delete \
    && find node_modules -name ".babelrc*" -delete \
    && find node_modules -name ".editorconfig" -delete \
    && find node_modules -name ".npmignore" -delete \
    && find node_modules -name ".gitattributes" -delete \
    && find node_modules -name ".gitignore" -delete \
    && find node_modules -name ".npmrc" -delete \
    && find node_modules -name ".yarnrc" -delete \
    && find node_modules -name ".yarn-integrity" -delete \
    && find node_modules -type d -name "test" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name ".github" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name "example" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name "examples" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name "benchmark" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name "benchmarks" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name "doc" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name "coverage" -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type d -name ".nyc_output" -exec rm -rf {} + 2>/dev/null || true

# 创建非root用户
RUN addgroup -g 1001 -S appuser && \
    adduser -S -D -H -u 1001 -s /sbin/nologin -G appuser -g appuser appuser

# 创建数据目录并设置权限
RUN mkdir -p data/uploads data/backups && \
    chown -R appuser:appuser /app

# 切换到非root用户
USER appuser

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
