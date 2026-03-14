const WebSocket = require('ws');
const log = require('../utils/logger');
const config = require('../config');
const { getSession } = require('../services/session');

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
  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const cookies = parseCookies(request.headers.cookie || '');
    const sessionId = cookies[config.cookieName];

    if (!sessionId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const session = await getSession(sessionId);
      if (!session?.username) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.username = session.username;
        wss.emit('connection', ws, request);
      });
    } catch (error) {
      log('ERROR', 'WebSocket 会话校验失败', { error: error.message });
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    const username = ws.username;

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

// 广播消息给所有客户端或指定用户
function broadcast(type, data, options = {}) {
  if (!wss) {
    log('WARN', 'WebSocket服务器未初始化，无法广播消息');
    return;
  }

  const message = JSON.stringify({ type, ...data });
  let sentCount = 0;
  let totalClients = 0;
  const { username: targetUsername } = options;

  log('INFO', 'WebSocket开始广播', { type, targetUsername, clientCount: wss.clients.size });

  wss.clients.forEach((client) => {
    totalClients++;

    // 如果指定了用户名，只发送给该用户
    if (targetUsername && client.username !== targetUsername) {
      return;
    }

    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sentCount++;
    }
  });

  log('INFO', 'WebSocket广播完成', { type, targetUsername, totalClients, sentCount });
}

// 广播笔记更新
function broadcastNoteUpdate(username, note) {
  broadcast('note_update', { note }, { username });
}

// 广播笔记删除
function broadcastNoteDelete(username, noteId) {
  broadcast('note_delete', { noteId }, { username });
}

// 广播批量笔记更新
function broadcastBatchNotesUpdate(username, notes) {
  broadcast('batch_notes_update', { notes }, { username });
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

function parseCookies(cookieHeader) {
  return cookieHeader.split(';').reduce((cookies, part) => {
    const [key, ...valueParts] = part.split('=');
    const cookieKey = key && key.trim();
    if (!cookieKey) {
      return cookies;
    }

    cookies[cookieKey] = decodeURIComponent(valueParts.join('=').trim());
    return cookies;
  }, {});
}
