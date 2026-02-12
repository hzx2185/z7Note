#!/bin/bash

# iPhone CalDAV 测试脚本

echo "=========================================="
echo "z7Note iPhone CalDAV 测试"
echo "=========================================="
echo ""

# 配置
SERVER="https://z7note.255556.xyz"
USERNAME="snowfly"
PASSWORD=""  # 请在此处输入您的密码

echo "1. 测试 OPTIONS 请求（CORS 预检）..."
echo "   端点: $SERVER/caldav/"
RESPONSE=$(curl -s -X OPTIONS "$SERVER/caldav/" -I)
echo "$RESPONSE" | grep -E "HTTP|Allow|DAV"
echo ""

echo "2. 测试 PROPFIND 请求（需要认证）..."
echo "   提示: 请输入您的 z7Note 密码"
read -s -p "密码: " PASSWORD
echo ""
echo ""

echo "   测试端点: $SERVER/caldav/$USERNAME"
RESPONSE=$(curl -s -X PROPFIND "$SERVER/caldav/$USERNAME" \
  -H "Authorization: Basic $(echo -n "$USERNAME:$PASSWORD" | base64)" \
  -H "Depth: 0" \
  -I)

HTTP_STATUS=$(echo "$RESPONSE" | grep -E "^HTTP" | cut -d' ' -f2)
if [ "$HTTP_STATUS" = "207" ]; then
  echo "   ✅ PROPFIND 请求成功 (HTTP 207)"
else
  echo "   ❌ PROPFIND 请求失败 (HTTP $HTTP_STATUS)"
fi
echo ""

echo "3. 测试 GET 请求（获取 iCal 数据）..."
RESPONSE=$(curl -s -X GET "$SERVER/caldav/$USERNAME" \
  -H "Authorization: Basic $(echo -n "$USERNAME:$PASSWORD" | base64)" \
  -I)

HTTP_STATUS=$(echo "$RESPONSE" | grep -E "^HTTP" | cut -d' ' -f2)
if [ "$HTTP_STATUS" = "200" ]; then
  echo "   ✅ GET 请求成功 (HTTP 200)"
  CONTENT_TYPE=$(echo "$RESPONSE" | grep -i "Content-Type" | cut -d' ' -f2-)
  echo "   Content-Type: $CONTENT_TYPE"
else
  echo "   ❌ GET 请求失败 (HTTP $HTTP_STATUS)"
fi
echo ""

echo "=========================================="
echo "iPhone CalDAV 配置信息"
echo "=========================================="
echo ""
echo "服务器地址: $SERVER/caldav"
echo "用户名: $USERNAME"
echo "密码: 您的 z7Note 密码"
echo ""
echo "配置步骤："
echo "1. 打开 iPhone \"设置\" → \"日历\" → \"账户\" → \"添加账户\""
echo "2. 选择 \"其他\" → \"CalDAV 账户\""
echo "3. 输入以下信息："
echo "   - 服务器: $SERVER/caldav"
echo "   - 用户名: $USERNAME"
echo "   - 密码: 您的 z7Note 密码"
echo "4. 点击 \"下一步\""
echo "5. 选择要同步的内容（日历、提醒事项）"
echo "6. 点击 \"保存\""
echo ""
echo "=========================================="
echo "故障排除"
echo "=========================================="
echo ""
echo "如果仍然提示 SSL 错误："
echo "1. 检查 iPhone 系统版本（建议 iOS 12 或更高）"
echo "2. 尝试在 Safari 中访问: $SERVER"
echo "3. 如果 Safari 可以访问，说明 SSL 证书正常"
echo "4. 确保使用 HTTPS，不是 HTTP"
echo "5. 检查服务器时间是否正确"
echo ""
echo "如果认证失败："
echo "1. 确认用户名和密码正确"
echo "2. 确保用户在 z7Note 中已注册"
echo "3. 尝试在 Web 界面登录验证"
echo ""
