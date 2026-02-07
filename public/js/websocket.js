// WebSocket客户端管理
class WebSocketManager {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.isConnected = false;
    this.messageHandlers = new Map();
    this.connectPromise = null;
  }

  // 连接WebSocket
  async connect() {
    // 如果正在连接，返回现有的Promise
    if (this.connectPromise) {
      return this.connectPromise;
    }

    // 如果已经连接，直接返回
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.connectPromise = new Promise((resolve, reject) => {
      try {
        // 获取用户名（从localStorage中，因为cookie是httpOnly的）
        const username = this.getUsername();
        if (!username) {
          reject(new Error('未找到用户信息'));
          return;
        }

        // 构建WebSocket URL
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.host}/ws?token=${username}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.connectPromise = null;
          resolve();

          // 发送心跳
          this.startHeartbeat();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (e) {
            // 静默处理解析错误
          }
        };

        this.ws.onclose = (event) => {
          this.isConnected = false;
          this.connectPromise = null;
          this.stopHeartbeat();

          // 尝试重新连接
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), this.reconnectDelay);
          }
        };

        this.ws.onerror = (error) => {
          this.connectPromise = null;
          reject(error);
        };
      } catch (e) {
        this.connectPromise = null;
        reject(e);
      }
    });

    return this.connectPromise;
  }

  // 从localStorage获取用户名
  getUsername() {
    const username = localStorage.getItem('z7note_username');
    return username;
  }

  // 设置用户名（登录时调用）
  setUsername(username) {
    localStorage.setItem('z7note_username', username);
  }

  // 清除用户名（登出时调用）
  clearUsername() {
    localStorage.removeItem('z7note_username');
  }

  // 处理消息
  handleMessage(data) {
    // 调用注册的消息处理器
    const handlers = this.messageHandlers.get(data.type) || [];
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (e) {
        // 静默处理处理器错误
      }
    });
  }

  // 注册消息处理器
  on(type, handler) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type).push(handler);
  }

  // 移除消息处理器
  off(type, handler) {
    const handlers = this.messageHandlers.get(type) || [];
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  // 发送消息
  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  // 开始心跳
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('ping', {});
      }
    }, 30000); // 每30秒发送一次心跳
  }

  // 停止心跳
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // 断开连接
  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.connectPromise = null;
  }

  // 获取连接状态
  getConnectionState() {
    if (!this.ws) return 'disconnected';
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
        return 'closing';
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'unknown';
    }
  }
}

// 创建全局实例
const wsManager = new WebSocketManager();

// 导出
export default wsManager;
