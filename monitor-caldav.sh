#!/bin/bash

echo "========================================"
echo "  CalDAV 实时日志监控"
echo "========================================"
echo
echo "请在 macOS 日历中添加账户："
echo "  用户名: testuser"
echo "  密码: 123456"
echo "  服务器: http://localhost:3000/caldav/"
echo
echo "按 Ctrl+C 停止监控"
echo
echo "========================================"
echo

docker logs -f z7note 2>&1 | grep --line-buffered -E "CalDAV|Basic Auth"
