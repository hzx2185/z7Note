/**
 * 浏览器通知处理逻辑
 */

class NotificationManager {
  constructor() {
    this.hasPermission = false;
    this.init();
  }

  async init() {
    if (!("Notification" in window)) {
      console.log("此浏览器不支持桌面通知");
      return;
    }

    if (Notification.permission === "granted") {
      this.hasPermission = true;
    } else if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      this.hasPermission = (permission === "granted");
    }
  }

  /**
   * 显示通知
   */
  show(title, options = {}) {
    if (!this.hasPermission) return;

    const notification = new Notification(title, {
      icon: '/favicon.png',
      badge: '/favicon.png',
      ...options
    });

    notification.onclick = function() {
      window.focus();
      if (options.url) {
        window.location.href = options.url;
      }
      this.close();
    };
  }

  /**
   * 处理后端发送的提醒消息
   */
  handleReminder(data) {
    const item = data.item;
    const typeLabel = data.itemType === 'event' ? '📅 事件提醒' : '✅ 待办提醒';
    
    // 桌面通知
    this.show(`${typeLabel}: ${item.title}`, {
      body: `${item.timeStr}\n${item.description || ''}`,
      tag: `reminder-${item.id}`,
      requireInteraction: true // 保持通知直到用户交互
    });

    // 同时在页面内显示一个简单的 Alert 或 Toast 作为备选
    console.log('[Notification] 收到提醒:', item);
  }
}

const notificationManager = new NotificationManager();

// 如果 WebSocketManager 已连接，注册处理器
if (window.wsManager) {
  window.wsManager.on('reminder', (data) => notificationManager.handleReminder(data));
} else {
  // 延迟检查，兼容异步加载
  document.addEventListener('DOMContentLoaded', () => {
    if (window.wsManager) {
      window.wsManager.on('reminder', (data) => notificationManager.handleReminder(data));
    }
  });
}

window.notificationManager = notificationManager;
