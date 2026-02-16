/**
 * 提醒设置页面逻辑
 */

const ReminderSettings = (function() {
  // API 请求
  async function apiRequest(url, options = {}) {
    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API请求失败:', error);
      throw error;
    }
  }

  // 显示通知
  function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '⚠';
    notification.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    notification.className = `notification ${type} show`;

    setTimeout(() => {
      notification.classList.remove('show');
    }, 3000);
  }

  // 加载提醒设置
  async function loadSettings() {
    const loading = document.getElementById('loading');
    const form = document.getElementById('reminder-settings-form');

    loading.classList.add('show');

    try {
      const settings = await apiRequest('/api/reminders');

      if (settings) {
        form.event_reminder_enabled.checked = settings.event_reminder_enabled === 1;
        form.todo_reminder_enabled.checked = settings.todo_reminder_enabled === 1;
        form.reminder_advance_days.value = settings.reminder_advance_days || 0;
        form.reminder_advance_hours.value = settings.reminder_advance_hours || 1;
        form.reminder_advance_minutes.value = settings.reminder_advance_minutes || 0;
        form.email_reminder_enabled.checked = settings.email_reminder_enabled === 1;
        form.browser_reminder_enabled.checked = settings.browser_reminder_enabled === 1;
        form.caldav_reminder_enabled.checked = settings.caldav_reminder_enabled === 1;
        form.quiet_start_time.value = settings.quiet_start_time || '22:00';
        form.quiet_end_time.value = settings.quiet_end_time || '08:00';

        // 高亮当前时间预设
        highlightTimePreset(
          settings.reminder_advance_days || 0,
          settings.reminder_advance_hours || 1,
          settings.reminder_advance_minutes || 0
        );
      }
    } catch (error) {
      console.error('加载提醒设置失败:', error);
      showNotification('加载设置失败', 'error');
    } finally {
      loading.classList.remove('show');
    }
  }

  // 高亮时间预设
  function highlightTimePreset(days, hours, minutes) {
    const presets = document.querySelectorAll('.time-preset[data-days]');
    presets.forEach(preset => {
      const presetDays = parseInt(preset.dataset.days);
      const presetHours = parseInt(preset.dataset.hours);
      const presetMinutes = parseInt(preset.dataset.minutes);

      if (presetDays === days && presetHours === hours && presetMinutes === minutes) {
        preset.classList.add('active');
      } else {
        preset.classList.remove('active');
      }
    });
  }

  // 保存提醒设置
  async function saveSettings(e) {
    e.preventDefault();

    const form = e.target;
    const loading = document.getElementById('loading');

    loading.classList.add('show');

    try {
      const settings = {
        event_reminder_enabled: form.event_reminder_enabled.checked ? 1 : 0,
        todo_reminder_enabled: form.todo_reminder_enabled.checked ? 1 : 0,
        reminder_advance_days: parseInt(form.reminder_advance_days.value) || 0,
        reminder_advance_hours: parseInt(form.reminder_advance_hours.value) || 1,
        reminder_advance_minutes: parseInt(form.reminder_advance_minutes.value) || 0,
        email_reminder_enabled: form.email_reminder_enabled.checked ? 1 : 0,
        browser_reminder_enabled: form.browser_reminder_enabled.checked ? 1 : 0,
        caldav_reminder_enabled: form.caldav_reminder_enabled.checked ? 1 : 0,
        quiet_start_time: form.quiet_start_time.value,
        quiet_end_time: form.quiet_end_time.value
      };

      await apiRequest('/api/reminders', {
        method: 'PUT',
        body: JSON.stringify(settings)
      });

      showNotification('设置保存成功');

      // 如果启用了浏览器通知，请求权限
      if (settings.browser_reminder_enabled && 'Notification' in window) {
        if (Notification.permission === 'default') {
          await Notification.requestPermission();
          if (Notification.permission === 'granted') {
            showNotification('浏览器通知权限已授予');
          } else {
            showNotification('浏览器通知权限被拒绝', 'error');
          }
        }
      }
    } catch (error) {
      console.error('保存提醒设置失败:', error);
      showNotification('保存设置失败', 'error');
    } finally {
      loading.classList.remove('show');
    }
  }

  // 加载提醒历史
  async function loadHistory() {
    const historyList = document.getElementById('history-list');

    try {
      const history = await apiRequest('/api/reminders/history?limit=50');

      if (!history || history.length === 0) {
        historyList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-text">暂无提醒历史</div>
          </div>
        `;
        return;
      }

      historyList.innerHTML = history.map(item => {
        const timeStr = new Date(item.reminder_time * 1000).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        const sentAtStr = item.sent_at ? new Date(item.sent_at * 1000).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }) : '未发送';

        return `
          <div class="history-item">
            <div class="history-item-content">
              <div class="history-item-title">
                ${item.type === 'event' ? '📅 事件' : '✅ 待办'}提醒
                <span class="badge badge-method badge-${item.method}">${getMethodLabel(item.method)}</span>
              </div>
              <div class="history-item-meta">
                <span>提醒时间: ${timeStr}</span>
                ${item.sent_at ? `<span>发送时间: ${sentAtStr}</span>` : ''}
              </div>
              ${item.error_message ? `<div class="history-item-error">❌ ${item.error_message}</div>` : ''}
            </div>
            <div class="history-item-status ${item.status}">${getStatusEmoji(item.status)}</div>
          </div>
        `;
      }).join('');
    } catch (error) {
      console.error('加载提醒历史失败:', error);
      showNotification('加载历史失败', 'error');
    }
  }

  // 清除提醒历史
  async function clearHistory() {
    if (!confirm('确定要清除30天前的提醒历史吗？')) {
      return;
    }

    try {
      await apiRequest('/api/reminders/history?days=30', {
        method: 'DELETE'
      });

      showNotification('历史记录已清除');
      loadHistory();
    } catch (error) {
      console.error('清除提醒历史失败:', error);
      showNotification('清除历史失败', 'error');
    }
  }

  // 获取方式标签
  function getMethodLabel(method) {
    const labels = {
      'email': '邮件',
      'browser': '浏览器',
      'caldav': '日历'
    };
    return labels[method] || method;
  }

  // 获取状态标签
  function getStatusLabel(status) {
    const labels = {
      'pending': '待发送',
      'sent': '已发送',
      'failed': '发送失败'
    };
    return labels[status] || status;
  }

  // 获取状态表情
  function getStatusEmoji(status) {
    const emojis = {
      'pending': '⏳',
      'sent': '✓',
      'failed': '✕'
    };
    return emojis[status] || '❓';
  }

  // 绑定时间预设按钮
  function bindTimePresets() {
    const presets = document.querySelectorAll('.time-preset[data-days]');
    presets.forEach(preset => {
      preset.addEventListener('click', () => {
        const days = parseInt(preset.dataset.days);
        const hours = parseInt(preset.dataset.hours);
        const minutes = parseInt(preset.dataset.minutes);

        const form = document.getElementById('reminder-settings-form');
        form.reminder_advance_days.value = days;
        form.reminder_advance_hours.value = hours;
        form.reminder_advance_minutes.value = minutes;

        highlightTimePreset(days, hours, minutes);
      });
    });

    // 绑定免打扰时间预设
    const quietPresets = document.querySelectorAll('.time-preset[data-start]');
    quietPresets.forEach(preset => {
      preset.addEventListener('click', () => {
        const start = preset.dataset.start;
        const end = preset.dataset.end;
        const isQuiet = preset.dataset.isQuiet === 'true';

        const form = document.getElementById('reminder-settings-form');
        if (isQuiet) {
          form.quiet_start_time.value = start;
          form.quiet_end_time.value = end;
        } else {
          // 关闭免打扰：设置无效的时间段
          form.quiet_start_time.value = '00:00';
          form.quiet_end_time.value = '00:00';
        }

        // 更新按钮状态
        quietPresets.forEach(p => p.classList.remove('active'));
        preset.classList.add('active');
      });
    });
  }

  // 初始化
  function init() {
    // 绑定表单提交
    document.getElementById('reminder-settings-form').addEventListener('submit', saveSettings);

    // 绑定时间预设
    bindTimePresets();

    // 加载设置
    loadSettings();

    // 加载历史
    loadHistory();

    // 暴露全局函数
    window.loadHistory = loadHistory;
    window.clearHistory = clearHistory;
  }

  return {
    init
  };
})();

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', ReminderSettings.init);
