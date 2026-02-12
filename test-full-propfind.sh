#!/bin/bash

echo "========================================"
echo "  测试完整的 PROPFIND 请求属性"
echo "========================================"
echo

BASE_URL="http://localhost:3000/caldav"
USERNAME="testuser"
PASSWORD="123456"

echo "测试 1: 请求 displayname 和 resourcetype"
echo
curl -s -X PROPFIND $BASE_URL/ \
  -u $USERNAME:$PASSWORD \
  -H "Depth: 1" \
  -H "Content-Type: text/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/><resourcetype/></prop></propfind>' | xmllint --format - | head -30
echo

echo "测试 2: 请求 current-user-principal 和 calendar-home-set"
echo
curl -s -X PROPFIND $BASE_URL/ \
  -u $USERNAME:$PASSWORD \
  -H "Depth: 0" \
  -H "Content-Type: text/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><current-user-principal/><calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"/></prop></propfind>' | xmllint --format - | head -30
echo

echo "测试 3: 请求所有常见属性"
echo
curl -s -X PROPFIND $BASE_URL/ \
  -u $USERNAME:$PASSWORD \
  -H "Depth: 1" \
  -H "Content-Type: text/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?>
<propfind xmlns="DAV:">
  <prop>
    <displayname/>
    <resourcetype/>
    <current-user-principal/>
    <getcontenttype/>
    <getetag/>
  </prop>
</propfind>' | xmllint --format - | head -50
echo

echo "========================================"
echo "  测试完成"
echo "========================================"
