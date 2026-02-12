#!/bin/bash

echo "=== CalDAV 功能测试 ==="
echo

echo "1. 测试根路径 PROPFIND..."
curl -s -X PROPFIND http://localhost:3000/caldav/ \
  -u testuser:123456 \
  -H "Depth: 1" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>' | grep -q "testuser@z7note" && echo "✅ 根路径 PROPFIND 成功" || echo "❌ 根路径 PROPFIND 失败"

echo
echo "2. 测试用户日历 PROPFIND..."
curl -s -X PROPFIND http://localhost:3000/caldav/testuser/ \
  -u testuser:123456 \
  -H "Depth: 0" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>' | grep -q "testuser" && echo "✅ 用户日历 PROPFIND 成功" || echo "❌ 用户日历 PROPFIND 失败"

echo
echo "3. 测试获取日历数据..."
curl -s http://localhost:3000/caldav/testuser/ \
  -u testuser:123456 | grep -q "BEGIN:VCALENDAR" && echo "✅ 获取日历数据成功" || echo "❌ 获取日历数据失败"

echo
echo "=== 测试完成 ==="
