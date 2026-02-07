const WebSocket = require('ws');
const log = require('../utils/logger');

// WebSocket服务器实例
let wss = null;

// 生成唯一ID
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// 初始化WebSocket服务器
function initWebSocketServer(server) {
  wss = new WebSocket.Server({ noServer: true });

  // 处理HTTP升级请求
  server.on('upgrade', (request, socket, head) => {
    // 从URL中获取token
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 验证token（这里简化处理，实际应该从数据库验证）
    // 由于token验证逻辑在中间件中，这里直接接受
    wss.handleUpgrade(request, socket, head, (ws) => {
      // 将token附加到ws对象上
      ws.token = token;
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request) => {
    // 从ws对象上获取token（实际是用户名）
    const username = ws.token;

    if (!username) {
      log('WARN', 'WebSocket连接失败：缺少用户名');
      ws.close();
      return;
    }

    // 生成唯一的客户端ID
    ws.id = generateUniqueId();
    ws.username = username;
    ws.userId = username; // 保持兼容性
    ws.isAlive = true;

    log('INFO', 'WebSocket客户端连接', { username, clientId: ws.id });

    // 发送欢迎消息
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'WebSocket连接成功',
      username
    }));

    // 处理客户端消息
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        handleMessage(ws, data);
      } catch (e) {
        log('ERROR', 'WebSocket消息解析失败', { error: e.message });
      }
    });

    // 处理心跳
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // 处理断开连接
    ws.on('close', () => {
      log('INFO', 'WebSocket客户端断开', { username });
    });

    // 处理错误
    ws.on('error', (error) => {
      log('ERROR', 'WebSocket错误', { username, error: error.message });
    });
  });

  // 定期检查心跳，清理死连接
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  log('INFO', 'WebSocket服务器已启动');
}

// 处理客户端消息
function handleMessage(ws, data) {
  switch (data.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    case 'subscribe':
      // 订阅特定笔记的更新
      ws.subscriptions = ws.subscriptions || new Set();
      if (data.noteId) {
        ws.subscriptions.add(data.noteId);
      }
      break;
    case 'unsubscribe':
      // 取消订阅
      if (ws.subscriptions && data.noteId) {
        ws.subscriptions.delete(data.noteId);
      }
      break;
    default:
      log('WARN', '未知的WebSocket消息类型', { type: data.type });
  }
}

// 广播消息给所有客户端
function broadcast(type, data) {
  if (!wss) {
    log('WARN', 'WebSocket服务器未初始化，无法广播消息');
    return;
  }

  const message = JSON.stringify({ type, ...data });
  let sentCount = 0;
  let totalClients = 0;

  wss.clients.forEach((client) => {
    totalClients++;
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sentCount++;
    }
  });

  log('INFO', 'WebSocket广播完成', { type, totalClients, sentCount });
}

// 广播笔记更新
function broadcastNoteUpdate(note) {
  broadcast('note_update', { note });
}

// 广播笔记删除
function broadcastNoteDelete(noteId) {
  broadcast('note_delete', { noteId });
}

// 广播笔记更新
function broadcastNoteUpdate(note, excludeUserId = null) {
  broadcast('note_update', { note }, excludeUserId);
}

// 广播笔记删除
function broadcastNoteDelete(noteId, excludeUserId = null) {
  broadcast('note_delete', { noteId }, excludeUserId);
}

// 广播批量笔记更新
function broadcastBatchNotesUpdate(notes, excludeUserId = null) {
  broadcast('batch_notes_update', { notes }, excludeUserId);
}

// 获取在线用户列表
function getOnlineUsers() {
  if (!wss) return [];

  const users = new Set();
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.userId) {
      users.add(client.userId);
    }
  });
  return Array.from(users);
}

// 获取在线客户端数量
function getOnlineCount() {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      count++;
    }
  });
  return count;
}

module.exports = {
  initWebSocketServer,
  broadcast,
  broadcastNoteUpdate,
  broadcastNoteDelete,
  broadcastBatchNotesUpdate,
  getOnlineUsers,
  getOnlineCount
};
