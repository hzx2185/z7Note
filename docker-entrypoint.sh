#!/bin/sh
set -e

# 1. 修复挂载目录权限 (以 root 身份执行)
echo "正在修复目录权限..."
chown -R 1001:1001 /app/data /app/logs

# 2. 使用 su-exec 切换到 appuser (1001) 并运行传入的命令
# su-exec 是 alpine 下非常轻量的工具，效果等同于 gosu
echo "权限修复完成，正在切换到 appuser (1001) 运行程序..."
exec su-exec 1001:1001 "$@"
