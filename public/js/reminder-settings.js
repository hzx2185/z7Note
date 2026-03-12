// 提醒设置页面脚本
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('reminder-settings-form');
    const notification = document.getElementById('notification');
    const loading = document.getElementById('loading');
    const historyList = document.getElementById('history-list');
    const todoCompleteCheckbox = document.querySelector('input[name="todo_complete_to_event"]');
    const deleteGroup = document.getElementById('delete-after-convert-group');

    // 切换转换后删除选项的显示
    function updateDeleteGroup() {
        if (todoCompleteCheckbox) {
            deleteGroup.style.display = todoCompleteCheckbox.checked ? 'block' : 'none';
        }
    }

    if (todoCompleteCheckbox) {
        todoCompleteCheckbox.addEventListener('change', updateDeleteGroup);
    }

    // 显示通知
    function showNotification(message, type = 'success') {
        notification.textContent = message;
        // 清除旧类名并添加新类名
        notification.className = `notification show ${type}`;
        
        // 3秒后隐藏
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    // 获取并填充设置
    async function loadSettings() {
        try {
            const response = await fetch('/api/reminders/');
            if (!response.ok) throw new Error('获取设置失败');
            
            const settings = await response.json();
            
            // 填充表单
            Object.keys(settings).forEach(key => {
                const input = form.elements[key];
                if (!input) return;

                if (input.type === 'checkbox') {
                    input.checked = settings[key] === 1;
                } else {
                    // 修复：显式检查 0 值，确保 0 不会被显示为空白
                    input.value = (settings[key] !== undefined && settings[key] !== null) ? settings[key] : '';
                }
            });

            updateDeleteGroup();
            
            // 隐藏加载状态
            if (loading) loading.classList.add('hidden');
        } catch (error) {
            console.error('加载设置失败:', error);
            showNotification('无法加载配置，请检查登录状态', 'error');
            if (loading) loading.innerHTML = '<div style="color:var(--red); font-weight:bold;">⚠️ 加载配置失败，请刷新页面</div>';
        }
    }

    // 获取并渲染历史记录
    window.loadHistory = async function() {
        try {
            historyList.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--gray); font-size:12px;">正在拉取日志...</div>';
            const response = await fetch('/api/reminders/history');
            if (!response.ok) throw new Error('获取历史记录失败');
            
            const history = await response.json();
            
            if (!history || history.length === 0) {
                historyList.innerHTML = '<div style="text-align:center; padding: 30px; color: var(--gray); font-size:12px;">暂无提醒记录</div>';
                return;
            }

            historyList.innerHTML = history.map(item => {
                const date = new Date(item.reminder_time * 1000);
                const timeStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
                
                const statusClass = item.status === 'sent' ? 'status-sent' : (item.status === 'failed' ? 'status-failed' : '');
                const statusText = item.status === 'sent' ? '成功' : (item.status === 'failed' ? '失败' : '待处理');
                const typeIcon = item.type === 'event' ? '📅' : '✅';
                
                return `
                    <div class="history-item">
                        <div>
                            <span style="font-weight:600;">${typeIcon} ${item.type === 'event' ? '事件' : '待办'}</span>
                            <span style="color:var(--gray); margin-left:4px; font-size:11px;">[${item.method}]</span>
                            <div style="color:var(--gray); font-size:11px; margin-top:2px;">${timeStr}</div>
                        </div>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('加载历史失败:', error);
            historyList.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--red); font-size:12px;">无法拉取日志</div>';
        }
    };

    // 保存设置
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const data = {};
        
        const expectedFields = [
            'event_reminder_enabled', 'todo_reminder_enabled',
            'reminder_advance_days', 'reminder_advance_hours', 'reminder_advance_minutes',
            'email_reminder_enabled', 'browser_reminder_enabled', 'caldav_reminder_enabled',
            'quiet_start_time', 'quiet_end_time',
            'todo_complete_to_event', 'delete_todo_after_convert'
        ];

        expectedFields.forEach(field => {
            const input = form.elements[field];
            if (!input) return;
            
            if (input.type === 'checkbox') {
                data[field] = input.checked ? 1 : 0;
            } else if (input.type === 'number') {
                data[field] = parseInt(input.value) || 0;
            } else {
                data[field] = input.value;
            }
        });

        try {
            const response = await fetch('/api/reminders/', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) throw new Error('保存失败');
            showNotification('✅ 设置已成功保存并应用');
        } catch (error) {
            showNotification('❌ 保存失败，请稍后重试', 'error');
        }
    });

    // 清除历史记录
    window.clearHistory = async function() {
        if (!confirm('确定要清空所有提醒历史记录吗？')) return;
        try {
            const response = await fetch('/api/reminders/history', { method: 'DELETE' });
            if (!response.ok) throw new Error('清除失败');
            showNotification('历史记录已清空');
            loadHistory();
        } catch (error) {
            showNotification('清除失败', 'error');
        }
    };

    // 初始化
    loadSettings();
    loadHistory();
});
