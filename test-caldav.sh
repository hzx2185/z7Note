#!/bin/bash

# CalDAV 测试和配置助手
# 用法: ./test-caldav.sh <username> <password> <server_url>

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 默认配置
DEFAULT_USERNAME="${CALDAV_USERNAME:-}"
DEFAULT_PASSWORD="${CALDAV_PASSWORD:-}"
DEFAULT_SERVER="${CALDAV_SERVER:-http://localhost:3000}"

# 参数处理
USERNAME="${1:-$DEFAULT_USERNAME}"
PASSWORD="${2:-$DEFAULT_PASSWORD}"
SERVER="${3:-$DEFAULT_SERVER}"

# 提示用户输入
if [ -z "$USERNAME" ]; then
    echo -n "请输入 z7Note 用户名: "
    read -r USERNAME
fi

if [ -z "$PASSWORD" ]; then
    echo -n "请输入 z7Note 密码: "
    read -s -r PASSWORD
    echo ""
fi

if [ -z "$SERVER" ]; then
    echo -n "请输入服务器地址 [默认: $DEFAULT_SERVER]: "
    read -r SERVER
    SERVER="${SERVER:-$DEFAULT_SERVER}"
fi

echo ""
echo "========================================"
echo "CalDAV 配置测试"
echo "========================================"
echo "服务器: $SERVER"
echo "用户名: $USERNAME"
echo "========================================"
echo ""

# 函数：测试端点
test_endpoint() {
    local description="$1"
    local method="$2"
    local url="$3"
    local extra_args="$4"

    echo -n "测试: $description ... "

    local response
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" $extra_args 2>&1)
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)

    if [ "$http_code" = "200" ] || [ "$http_code" = "207" ]; then
        echo -e "${GREEN}✓ 通过${NC} (HTTP $http_code)"
        return 0
    elif [ "$http_code" = "401" ]; then
        echo -e "${RED}✗ 认证失败${NC} (HTTP $http_code)"
        echo "  提示: 请检查用户名和密码"
        return 1
    elif [ "$http_code" = "404" ]; then
        echo -e "${RED}✗ 端点不存在${NC} (HTTP $http_code)"
        return 1
    else
        echo -e "${YELLOW}⚠ 意外响应${NC} (HTTP $http_code)"
        echo "  响应: $body"
        return 1
    fi
}

# 测试 1: 健康检查
echo "1. 基础连接测试"
echo "   ---"
test_endpoint "健康检查" "GET" "$SERVER/health" ""

# 测试 2: CalDAV OPTIONS
echo ""
echo "2. CalDAV 能力测试"
echo "   ---"
test_endpoint "CalDAV OPTIONS" "OPTIONS" "$SERVER/caldav/"

if curl -s -X OPTIONS "$SERVER/caldav/" 2>&1 | grep -q "calendar-access"; then
    echo "   ${GREEN}✓ CalDAV 支持已启用${NC}"
else
    echo "   ${RED}✗ CalDAV 支持未启用${NC}"
fi

# 测试 3: CalDAV PROPFIND
echo ""
echo "3. CalDAV 认证测试"
echo "   ---"
auth_header="Authorization: Basic $(echo -n "$USERNAME:$PASSWORD" | base64)"
test_endpoint "PROPFIND (认证)" "PROPFIND" "$SERVER/caldav/$USERNAME" \
    "-H 'Depth: 0' -H '$auth_header'"

# 测试 4: 获取 iCal 数据
echo ""
echo "4. 日历数据获取测试"
echo "   ---"
test_endpoint "GET iCal" "GET" "$SERVER/caldav/$USERNAME" \
    "-H '$auth_header'"

# 配置信息
echo ""
echo "========================================"
echo "CalDAV 配置信息"
echo "========================================"
echo ""
echo "请在您的 CalDAV 客户端中使用以下信息："
echo ""
echo "服务器地址: $SERVER/caldav"
echo "用户名: $USERNAME"
echo "密码: **** (您输入的密码)"
echo ""

# 客户端配置提示
echo "快速配置指南："
echo ""
echo "iOS/iPadOS:"
echo "  设置 → 日历 → 账户 → 添加账户 → 其他 → CalDAV"
echo "  服务器: $SERVER/caldav"
echo ""
echo "macOS:"
echo "  日历 → 设置 → 账户 → + → 其他 CalDAV 账户"
echo "  服务器地址: $SERVER/caldav"
echo ""
echo "Android (DAVx⁵):"
echo "  添加账户 → CalDAV"
echo "  基础 URL: $SERVER/caldav"
echo ""
echo "详细配置说明请查看: CALDAV_CLIENTS.md"
echo ""

# 故障排除
echo "========================================"
echo "故障排除"
echo "========================================"
echo ""
echo "如果测试失败，请检查："
echo "1. 服务器是否运行: curl $SERVER/health"
echo "2. 用户名和密码是否正确（可在 Web 界面测试）"
echo "3. 网络是否可达: ping $(echo $SERVER | sed 's|http.*//||' | sed 's|:.*||')"
echo "4. 防火墙是否开放端口 3000"
echo "5. 查看服务器日志: docker-compose logs -f"
echo ""

echo "测试完成！"
