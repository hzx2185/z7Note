#!/bin/bash

echo "======================================"
echo "  macOS CalDAV 诊断工具"
echo "======================================"
echo

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

info() {
    echo "ℹ️  $1"
}

echo "1. 检查服务器状态..."
if docker ps | grep -q z7note; then
    success "z7Note 容器正在运行"
else
    error "z7Note 容器未运行"
    echo "   运行: docker-compose up -d"
    exit 1
fi
echo

echo "2. 测试服务器健康状态..."
if curl -s http://localhost:3000/health | grep -q "ok"; then
    success "服务器健康检查通过"
else
    error "服务器健康检查失败"
    exit 1
fi
echo

echo "3. 测试根路径 PROPFIND..."
echo "   请求: http://localhost:3000/caldav/"
echo
RESPONSE=$(curl -s -X PROPFIND http://localhost:3000/caldav/ \
  -u testuser:123456 \
  -H "Depth: 1" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>')

if echo "$RESPONSE" | grep -q "testuser@z7note"; then
    success "根路径 PROPFIND 成功"
    echo "   发现日历: testuser@z7note"
else
    error "根路径 PROPFIND 失败"
    echo "   响应:"
    echo "$RESPONSE" | head -20
fi
echo

echo "4. 测试 Principal 路径..."
echo "   请求: http://localhost:3000/caldav/principal/testuser"
echo
RESPONSE=$(curl -s -X PROPFIND http://localhost:3000/caldav/principal/testuser \
  -u testuser:123456 \
  -H "Depth: 0" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>')

if echo "$RESPONSE" | grep -q "principal"; then
    success "Principal 路径成功"
else
    error "Principal 路径失败"
    echo "   响应:"
    echo "$RESPONSE" | head -20
fi
echo

echo "5. 测试用户日历 PROPFIND..."
echo "   请求: http://localhost:3000/caldav/testuser"
echo
RESPONSE=$(curl -s -X PROPFIND http://localhost:3000/caldav/testuser \
  -u testuser:123456 \
  -H "Depth: 0" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/><resourcetype/><current-user-principal/></prop></propfind>')

if echo "$RESPONSE" | grep -q "calendar"; then
    success "用户日历 PROPFIND 成功"
else
    error "用户日历 PROPFIND 失败"
    echo "   响应:"
    echo "$RESPONSE" | head -20
fi
echo

echo "6. 测试获取日历数据..."
echo "   请求: http://localhost:3000/caldav/testuser/"
echo
RESPONSE=$(curl -s http://localhost:3000/caldav/testuser/ -u testuser:123456)

if echo "$RESPONSE" | grep -q "BEGIN:VCALENDAR"; then
    success "获取日历数据成功"
    EVENT_COUNT=$(echo "$RESPONSE" | grep -c "BEGIN:VEVENT" || echo 0)
    TODO_COUNT=$(echo "$RESPONSE" | grep -c "BEGIN:VTODO" || echo 0)
    info "   事件数: $EVENT_COUNT, 待办数: $TODO_COUNT"
else
    error "获取日历数据失败"
    echo "   响应:"
    echo "$RESPONSE" | head -10
fi
echo

echo "7. 检查最近的 CalDAV 日志..."
echo
docker logs z7note --since 5m | grep -i "caldav\|basic auth" | tail -10
echo

echo "======================================"
echo "  诊断完成"
echo "======================================"
echo
echo "如果所有测试都通过，但 macOS 日历仍然无法连接："
echo
echo "1. 尝试在 macOS 日历中删除现有账户"
echo "2. 重新添加账户"
echo "3. 使用服务器地址: http://localhost:3000/caldav/"
echo "4. 确保用户名和密码正确: testuser / 123456"
echo
echo "详细配置请参考: MACOS_MODERN_CALENDAR.md"
