const express = require('express');
const router = express.Router();
const db = require('../db/client');
const { auth } = require('../middleware/auth');
const { toClientCalendarId } = require('../utils/calendarIds');

// 获取序时数据
router.get('/', async (req, res) => {
  console.log('[timeline API] 请求开始');
  try {
    // 检查用户是否已登录
    if (!req.user) {
      console.log('[timeline API] 用户未登录');
      return res.status(401).json({ 
        success: false, 
        message: '请先登录',
        code: 'UNAUTHORIZED'
      });
    }
    
    // req.user 可能是字符串（用户名）或对象
    const username = typeof req.user === 'string' ? req.user : req.user.username;
    console.log('[timeline API] 用户:', username);
    console.log('[timeline API] 查询参数:', req.query);
    const { page = 1, limit = 20, search = '', type = 'all', startDate, endDate } = req.query;
    
    const offset = (page - 1) * limit;
    let events = [];
    let todos = [];
    let notes = [];
    
    // 构建搜索条件
    const searchCondition = search ? 'AND (title LIKE ? OR description LIKE ?)' : '';
    const searchParams = search ? [`%${search}%`, `%${search}%`] : [];
    
    // 构建日期条件参数
    let dateParams = [];
    if (startDate && endDate) {
      dateParams = [parseInt(startDate), parseInt(endDate)];
    }
    
    // 查询事件
    if (type === 'all' || type === 'event') {
      let eventDateCondition = '';
      if (startDate && endDate) {
        eventDateCondition = 'AND startTime BETWEEN ? AND ?';
      }
      const eventQuery = `
        SELECT 
          id,
          title,
          description,
          startTime as timestamp,
          'event' as type,
          endTime,
          color
        FROM events
        WHERE username = ? ${searchCondition} ${eventDateCondition}
        ORDER BY startTime DESC
      `;
      events = await db.queryAll(eventQuery, [username, ...searchParams, ...dateParams]);
    }
    
    // 查询待办
    if (type === 'all' || type === 'todo') {
      let todoDateCondition = '';
      if (startDate && endDate) {
        todoDateCondition = 'AND dueDate BETWEEN ? AND ?';
      }
      const todoQuery = `
        SELECT 
          id,
          title,
          description,
          dueDate as timestamp,
          'todo' as type,
          completed,
          priority
        FROM todos
        WHERE username = ? ${searchCondition} ${todoDateCondition}
        ORDER BY dueDate DESC
      `;
      todos = await db.queryAll(todoQuery, [username, ...searchParams, ...dateParams]);
    }
    
    // 查询笔记
    if (type === 'all' || type === 'note') {
      let noteDateCondition = '';
      let noteDateParams = [];
      if (startDate && endDate) {
        noteDateCondition = 'AND updatedAt BETWEEN ? AND ?';
        noteDateParams = [parseInt(startDate), parseInt(endDate)];
      }
      const noteQuery = `
        SELECT 
          id,
          title,
          content as description,
          updatedAt as timestamp,
          'note' as type,
          updatedAt
        FROM notes
        WHERE username = ? AND deleted = 0 ${searchCondition} ${noteDateCondition}
        ORDER BY updatedAt DESC
      `;
      notes = await db.queryAll(noteQuery, [username, ...searchParams, ...noteDateParams]);
    }
    
    // 合并所有数据并按时间排序
    let allItems = [...events, ...todos, ...notes];
    
    // 排序 - 时间早的在前面
    allItems.sort((a, b) => a.timestamp - b.timestamp);
    
    // 分页
    const total = allItems.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedItems = allItems.slice(offset, offset + parseInt(limit));
    
    // 格式化数据
    const formattedItems = paginatedItems.map(item => {
      const date = new Date(item.timestamp * 1000);
      const now = new Date();
      const isOverdue = item.type === 'todo' && !item.completed && item.timestamp < Math.floor(now.getTime() / 1000);
      const clientId = (item.type === 'event' || item.type === 'todo') ? toClientCalendarId(username, item.id) : item.id;

      return {
        ...item,
        id: clientId,
        dateDisplay: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
        isOverdue
      };
    });
    
    const responseData = {
      success: true,
      data: {
        items: formattedItems,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      }
    };
    
    console.log('[timeline API] 返回数据:', {
      success: true,
      itemCount: formattedItems.length,
      total: total
    });
    
    res.json(responseData);
  } catch (err) {
    console.error('[timeline API] 获取序时数据失败:', err);
    res.status(500).json({ success: false, message: '获取数据失败', error: err.message });
  }
});

module.exports = router;
