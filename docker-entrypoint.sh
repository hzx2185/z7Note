#!/bin/sh
set -e

SECRETS_DIR="${Z7NOTE_SECRETS_DIR:-/app/data/secrets}"
JWT_SECRET_FILE="${JWT_SECRET_FILE:-$SECRETS_DIR/jwt-secret}"
ADMIN_REGISTRATION_TOKEN_FILE="${ADMIN_REGISTRATION_TOKEN_FILE:-$SECRETS_DIR/admin-registration-token}"

generate_secret() {
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
}

load_or_create_secret() {
  var_name="$1"
  file_path="$2"
  label="$3"
  current_value="$(eval "printf '%s' \"\${$var_name:-}\"")"

  if [ -n "$current_value" ]; then
    return 0
  fi

  if [ ! -s "$file_path" ]; then
    generate_secret > "$file_path"
    chmod 600 "$file_path"
    echo "已自动生成 ${label}，保存在 ${file_path}"
  else
    echo "已从 ${file_path} 读取 ${label}"
  fi

  secret_value="$(cat "$file_path")"
  export "$var_name=$secret_value"
}

# 1. 准备持久化目录和运行时密钥
mkdir -p /app/data /app/logs "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
load_or_create_secret JWT_SECRET "$JWT_SECRET_FILE" "JWT_SECRET"
load_or_create_secret ADMIN_REGISTRATION_TOKEN "$ADMIN_REGISTRATION_TOKEN_FILE" "ADMIN_REGISTRATION_TOKEN"

# 2. 修复挂载目录权限 (以 root 身份执行)
echo "正在修复目录权限..."
chown -R 1001:1001 /app/data /app/logs

# 3. 使用 su-exec 切换到 appuser (1001) 并运行传入的命令
# su-exec 是 alpine 下非常轻量的工具，效果等同于 gosu
echo "权限修复完成，正在切换到 appuser (1001) 运行程序..."
exec su-exec 1001:1001 "$@"
