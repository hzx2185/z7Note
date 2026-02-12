#!/bin/bash

echo "========================================"
echo "  模拟 macOS CalDAV 客户端请求序列"
echo "========================================"
echo

BASE_URL="http://localhost:3000/caldav"
USERNAME="testuser"
PASSWORD="123456"

echo "步骤 1: OPTIONS 请求（发现支持的方法）"
echo "   请求: OPTIONS $BASE_URL"
echo
RESPONSE=$(curl -s -X OPTIONS $BASE_URL \
  -u $USERNAME:$PASSWORD \
  -w "\nHTTP_CODE:%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
echo "   响应状态: $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ 成功"
else
    echo "   ❌ 失败"
fi
echo

echo "步骤 2: PROPFIND 根路径（发现服务）"
echo "   请求: PROPFIND $BASE_URL/ (Depth: 1)"
echo
RESPONSE=$(curl -s -X PROPFIND $BASE_URL/ \
  -u $USERNAME:$PASSWORD \
  -H "Depth: 1" \
  -H "Content-Type: text/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>' \
  -w "\nHTTP_CODE:%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
echo "   响应状态: $HTTP_CODE"
if [ "$HTTP_CODE" = "207" ]; then
    echo "   ✅ 成功"
    if echo "$RESPONSE" | grep -q "testuser@z7note"; then
        echo "   ✅ 发现日历: testuser@z7note"
    fi
else
    echo "   ❌ 失败"
    echo "   响应:"
    echo "$RESPONSE" | head -10
fi
echo

echo "步骤 3: PROPFIND 用户日历（获取日历属性）"
echo "   请求: PROPFIND $BASE_URL/$USERNAME/ (Depth: 0)"
echo
RESPONSE=$(curl -s -X PROPFIND $BASE_URL/$USERNAME/ \
  -u $USERNAME:$PASSWORD \
  -H "Depth: 0" \
  -H "Content-Type: text/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/><resourcetype/></prop></propfind>' \
  -w "\nHTTP_CODE:%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
echo "   响应状态: $HTTP_CODE"
if [ "$HTTP_CODE" = "207" ]; then
    echo "   ✅ 成功"
else
    echo "   ❌ 失败"
    echo "   响应:"
    echo "$RESPONSE" | head -10
fi
echo

echo "步骤 4: 获取日历数据"
echo "   请求: GET $BASE_URL/$USERNAME/"
echo
RESPONSE=$(curl -s $BASE_URL/$USERNAME/ \
  -u $USERNAME:$PASSWORD \
  -w "\nHTTP_CODE:%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
echo "   响应状态: $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ 成功"
    if echo "$RESPONSE" | grep -q "BEGIN:VCALENDAR"; then
        echo "   ✅ iCalendar 格式正确"
    fi
else
    echo "   ❌ 失败"
fi
echo

echo "========================================"
echo "  测试完成"
echo "========================================"
