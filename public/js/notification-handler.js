/**
 * 浏览器通知处理器
 * 处理通过WebSocket接收的提醒通知
 */

class NotificationHandler {
  constructor() {
    this.permission = 'default';
    this.init();
  }

  init() {
    // 检查浏览器是否支持通知
    if ('Notification' in window) {
      this.permission = Notification.permission;
    }
  }

  /**
   * 请求通知权限
   */
  async requestPermission() {
    if (!('Notification' in window)) {
      console.warn('浏览器不支持通知API');
      return false;
    }

    if (this.permission === 'granted') {
      return true;
    }

    if (this.permission !== 'denied') {
      const result = await Notification.requestPermission();
      this.permission = result;
      return result === 'granted';
    }

    return false;
  }

  /**
   * 显示通知
   */
  show(title, options = {}) {
    if (!('Notification' in window)) {
      console.warn('浏览器不支持通知API');
      return;
    }

    if (this.permission !== 'granted') {
      console.warn('通知权限未授予');
      return;
    }

    const defaultOptions = {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: options.tag || Date.now().toString(),
      requireInteraction: false,
      silent: false,
      timestamp: Date.now()
    };

    const notification = new Notification(title, { ...defaultOptions, ...options });

    // 点击通知时聚焦窗口
    notification.onclick = () => {
      window.focus();
      notification.close();

      // 如果有URL，跳转到该地址
      if (options.url) {
        window.location.href = options.url;
      }
    };

    // 10秒后自动关闭
    setTimeout(() => {
      notification.close();
    }, 10000);

    return notification;
  }

  /**
   * 显示提醒通知
   */
  showReminder(data) {
    const { itemType, item } = data;
    const isEvent = itemType === 'event';

    const title = isEvent ? '📅 事件提醒' : '✅ 待办提醒';

    const body = `${item.title}\n⏰ ${item.timeStr || ''}${item.description ? '\n' + item.description : ''}`;

    this.show(title, {
      body,
      tag: `reminder-${item.id}`,
      url: '/calendar.html'
    });
  }

  /**
   * 显示系统通知
   */
  showSystem(title, message, type = 'info') {
    const icons = {
      info: 'ℹ️',
      success: '✓',
      warning: '⚠',
      error: '✕'
    };

    const body = `${icons[type] || ''} ${message}`;

    this.show(title, {
      body,
      tag: `system-${Date.now()}`
    });
  }

  /**
   * 检查权限状态
   */
  checkPermission() {
    if (!('Notification' in window)) {
      return 'unsupported';
    }

    return Notification.permission;
  }
}

// 创建全局实例
const notificationHandler = new NotificationHandler();

// 导出
export default notificationHandler;
