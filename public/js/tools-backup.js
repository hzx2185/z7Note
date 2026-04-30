// ==================== 备份配置相关函数 ====================

// 加载备份配置
export async function loadBackupConfig() {
    try {
        const res = await fetch('/api/user/backup/config');

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || '加载配置失败');
        }

        const config = await res.json();

        // 填充表单
        const modal = document.getElementById('backup-modal');
        if (!modal) {
            return;
        }

        // 检查所有必需的表单元素
        const elements = {
            'backup-enabled': { type: 'checkbox', value: config.enabled },
            'backup-schedule': { type: 'value', value: config.schedule || '0 20 * * *' },
            'backup-webdav-url': { type: 'value', value: config.webdavUrl || '' },
            'backup-webdav-username': { type: 'value', value: config.webdavUsername || '' },
            'backup-webdav-password': { type: 'value', value: config.webdavPassword || '' },
            'backup-include-attachments': { type: 'checkbox', value: config.includeAttachments },
            'backup-include-calendar': { type: 'checkbox', value: config.includeCalendar },
            'backup-include-todos': { type: 'checkbox', value: config.includeTodos },
            'backup-include-contacts': { type: 'checkbox', value: config.includeContacts },
            'backup-include-reminders': { type: 'checkbox', value: config.includeReminders },
            'backup-send-email': { type: 'checkbox', value: config.sendEmail },
            'backup-email-address': { type: 'value', value: config.emailAddress || '' }
        };

        for (const [id, elementConfig] of Object.entries(elements)) {
            const el = document.getElementById(id);
            if (!el) continue;

            if (elementConfig.type === 'checkbox') {
                el.checked = Boolean(elementConfig.value);
            } else {
                el.value = elementConfig.value;
            }
        }

        // 显示最后备份时间（如果有）
        const statusEl = document.getElementById('backup-status-text');
        if (statusEl) {
            if (config.lastBackupTime && config.lastBackupTime > 0) {
                const lastBackupDate = new Date(config.lastBackupTime);
                const formattedTime = lastBackupDate.toLocaleString('zh-CN');

                // 计算距离现在的时间
                const now = Date.now();
                const diff = now - config.lastBackupTime;
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const days = Math.floor(hours / 24);

                let timeText = '';
                if (days > 0) {
                    timeText = `${days}天前`;
                } else if (hours > 0) {
                    timeText = `${hours}小时前`;
                } else {
                    timeText = '刚刚';
                }

                statusEl.innerHTML = `<div class="backup-status-row">
                    <span>上次备份: <strong>${formattedTime}</strong></span>
                    <span class="backup-status-relative">${timeText}</span>
                </div>`;
                statusEl.style.display = 'block';
                statusEl.classList.remove('backup-status-warning', 'backup-status-idle', 'backup-status-enabled');
                statusEl.classList.add(config.enabled ? 'backup-status-enabled' : 'backup-status-idle');
            } else if (config.enabled) {
                statusEl.innerHTML = '<span>暂未备份过数据</span>';
                statusEl.style.display = 'block';
                statusEl.classList.remove('backup-status-enabled', 'backup-status-idle');
                statusEl.classList.add('backup-status-warning');
            } else {
                statusEl.style.display = 'none';
                statusEl.classList.remove('backup-status-enabled', 'backup-status-idle', 'backup-status-warning');
            }
        }
    } catch (e) {
        ui.showToast('加载配置失败: ' + e.message, false);
    }
}

// 保存备份配置
export async function saveBackupConfig(event) {
    event.preventDefault();

    // 检查 ui 对象是否存在
    if (!window.ui) {
        alert('UI 对象未初始化，请刷新页面重试');
        return;
    }


    // 获取表单元素
    const enabledEl = document.getElementById('backup-enabled');
    const scheduleEl = document.getElementById('backup-schedule');
    const webdavUrlEl = document.getElementById('backup-webdav-url');
    const webdavUsernameEl = document.getElementById('backup-webdav-username');
    const webdavPasswordEl = document.getElementById('backup-webdav-password');
    const includeAttachmentsEl = document.getElementById('backup-include-attachments');
    const includeCalendarEl = document.getElementById('backup-include-calendar');
    const includeTodosEl = document.getElementById('backup-include-todos');
    const includeContactsEl = document.getElementById('backup-include-contacts');
    const includeRemindersEl = document.getElementById('backup-include-reminders');
    const sendEmailEl = document.getElementById('backup-send-email');
    const emailAddressEl = document.getElementById('backup-email-address');

    // 检查元素是否存在

    if (!enabledEl || !scheduleEl || !webdavUrlEl || !webdavUsernameEl ||
        !webdavPasswordEl || !includeAttachmentsEl || !includeCalendarEl ||
        !includeTodosEl || !includeContactsEl || !includeRemindersEl ||
        !sendEmailEl || !emailAddressEl) {
        ui.showToast('表单元素未找到', false);
        return;
    }

    const config = {
        enabled: enabledEl.checked,
        schedule: scheduleEl.value,
        webdavUrl: webdavUrlEl.value.trim(),
        webdavUsername: webdavUsernameEl.value.trim(),
        webdavPassword: webdavPasswordEl.value,
        includeAttachments: includeAttachmentsEl.checked,
        includeCalendar: includeCalendarEl.checked,
        includeTodos: includeTodosEl.checked,
        includeContacts: includeContactsEl.checked,
        includeReminders: includeRemindersEl.checked,
        sendEmail: sendEmailEl.checked,
        emailAddress: emailAddressEl.value.trim()
    };

    // 验证必填字段
    if (config.enabled) {
        if (!config.webdavUrl) {
            ui.showToast('请填写 WebDAV 地址', false);
            webdavUrlEl.focus();
            return;
        }
        if (!config.webdavUsername) {
            ui.showToast('请填写 WebDAV 用户名', false);
            webdavUsernameEl.focus();
            return;
        }
        if (!config.webdavPassword) {
            ui.showToast('请填写 WebDAV 密码', false);
            webdavPasswordEl.focus();
            return;
        }

        // 验证 WebDAV URL 格式
        try {
            new URL(config.webdavUrl);
        } catch (e) {
            ui.showToast('WebDAV 地址格式不正确', false);
            webdavUrlEl.focus();
            return;
        }
    }

    if (config.sendEmail && !config.emailAddress) {
        ui.showToast('请填写邮箱地址', false);
        emailAddressEl.focus();
        return;
    }

    // 验证邮箱格式（如果填写了）
    if (config.emailAddress) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(config.emailAddress)) {
            ui.showToast('邮箱地址格式不正确', false);
            emailAddressEl.focus();
            return;
        }
    }

    try {
        ui.updateStatus('working', '正在保存...');

        const res = await fetch('/api/user/backup/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        }).catch(err => {
            throw new Error('网络请求失败，请检查网络连接');
        });


        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || '保存失败');
        }

        const result = await res.json();

        ui.showToast('配置已保存');
        ui.updateStatus('success', '配置已保存');

        // 刷新配置显示
        setTimeout(async () => {
            await loadBackupConfig();
        }, 100);

        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
            const modal = document.getElementById('backup-modal');
            if (modal) modal.classList.remove('show');
        }, 1500);
    } catch (e) {
        ui.updateStatus('error', '保存失败');
        alert('保存失败: ' + e.message);
        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 2000);
    }
}

// 测试 WebDAV 连接
export async function testWebDAVConnection() {
    try {
        const webdavUrl = document.getElementById('backup-webdav-url').value.trim();
        const webdavUsername = document.getElementById('backup-webdav-username').value.trim();
        const webdavPassword = document.getElementById('backup-webdav-password').value;

        if (!webdavUrl || !webdavUsername || !webdavPassword) {
            ui.showToast('请填写完整的 WebDAV 配置信息', false);
            return;
        }

        // 验证 URL 格式
        try {
            new URL(webdavUrl);
        } catch (e) {
            ui.showToast('WebDAV URL 格式不正确', false);
            return;
        }

        ui.updateStatus('working', '正在测试连接...');

        const res = await fetch('/api/user/backup/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                webdavUrl,
                webdavUsername,
                webdavPassword
            })
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({ error: '测试失败' }));
            throw new Error(error.error || '测试失败');
        }

        const result = await res.json();

        let message = 'WebDAV 连接成功！';
        if (result.details && result.details.hasBackupDir) {
            if (result.details.canCreateDirectory) {
                message = 'WebDAV 连接成功，可以正常备份';
            } else {
                message = 'WebDAV 连接成功，但无法自动创建目录。请在 WebDAV 中手动创建 /z7note-backups 目录';
            }
        } else {
            message = 'WebDAV 连接成功，但 /z7note-backups 目录不存在。请在 WebDAV 中手动创建该目录';
        }

        ui.updateStatus('success', '连接成功');
        ui.showToast(message);

        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 3000);
    } catch (e) {
        ui.updateStatus('error', '连接失败');
        alert('连接失败: ' + e.message);
        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 3000);
    }
}

// 立即备份
export async function backupNow() {
    // 检查 ui 对象是否存在
    if (!window.ui) {
        alert('UI 对象未初始化，请刷新页面重试');
        return;
    }

    // 检查是否正在备份
    const backupButton = document.querySelector('button[onclick="backupNow()"]');
    if (backupButton && backupButton.disabled) {
        alert('备份正在进行中，请稍候...');
        return;
    }

    try {
        ui.updateStatus('working', '正在准备备份...');

        // 禁用备份按钮
        if (backupButton) {
            backupButton.disabled = true;
            backupButton.textContent = '备份中...';
        }

        // 从服务器获取保存的配置
        const configRes = await fetch('/api/user/backup/config');
        if (!configRes.ok) {
            const errorData = await configRes.json();
            throw new Error(errorData.error || '获取配置失败');
        }
        const savedConfig = await configRes.json();

        // 验证 WebDAV 配置
        if (!savedConfig.webdavUrl || !savedConfig.webdavUsername || !savedConfig.webdavPassword) {
            ui.showToast('请先配置 WebDAV 信息', false);
            ui.updateStatus('error', '配置缺失');
            setTimeout(() => ui.updateStatus('idle', '就绪'), 2000);
            return;
        }

        // 使用表单中的值（可能用户刚修改还未保存）作为覆盖
        const formOverrides = {
            webdavUrl: document.getElementById('backup-webdav-url').value,
            webdavUsername: document.getElementById('backup-webdav-username').value,
            webdavPassword: document.getElementById('backup-webdav-password').value,
            includeAttachments: document.getElementById('backup-include-attachments').checked,
            includeCalendar: document.getElementById('backup-include-calendar').checked,
            includeTodos: document.getElementById('backup-include-todos').checked,
            includeContacts: document.getElementById('backup-include-contacts').checked,
            includeReminders: document.getElementById('backup-include-reminders').checked,
            sendEmail: document.getElementById('backup-send-email').checked,
            emailAddress: document.getElementById('backup-email-address').value
        };

        // 如果表单中有值，使用表单值；否则使用保存的值
        const backupConfig = {
            webdavUrl: formOverrides.webdavUrl || savedConfig.webdavUrl,
            webdavUsername: formOverrides.webdavUsername || savedConfig.webdavUsername,
            webdavPassword: formOverrides.webdavPassword || savedConfig.webdavPassword,
            includeAttachments: formOverrides.includeAttachments !== undefined ? formOverrides.includeAttachments : savedConfig.includeAttachments,
            includeCalendar: formOverrides.includeCalendar !== undefined ? formOverrides.includeCalendar : savedConfig.includeCalendar,
            includeTodos: formOverrides.includeTodos !== undefined ? formOverrides.includeTodos : savedConfig.includeTodos,
            includeContacts: formOverrides.includeContacts !== undefined ? formOverrides.includeContacts : savedConfig.includeContacts,
            includeReminders: formOverrides.includeReminders !== undefined ? formOverrides.includeReminders : savedConfig.includeReminders,
            sendEmail: formOverrides.sendEmail !== undefined ? formOverrides.sendEmail : savedConfig.sendEmail,
            emailAddress: formOverrides.emailAddress || savedConfig.emailAddress
        };

        // 验证必填字段
        if (!backupConfig.webdavUrl || !backupConfig.webdavUsername || !backupConfig.webdavPassword) {
            ui.showToast('请先配置 WebDAV 信息', false);
            ui.updateStatus('error', '配置缺失');
            setTimeout(() => ui.updateStatus('idle', '就绪'), 2000);
            return;
        }

        ui.updateStatus('working', '正在导出数据...');

        const res = await fetch('/api/user/backup/now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backupConfig)
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({ error: '备份失败' }));

            // 提供更友好的错误提示
            let errorMessage = error.error || '备份失败';
            if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
                errorMessage += '。请检查 WebDAV 权限，或手动在 WebDAV 中创建 /z7note-backups 目录';
            } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
                errorMessage += '。请检查 WebDAV 用户名和密码';
            } else if (errorMessage.includes('今日已备份')) {
                // 恢复按钮状态
                if (backupButton) {
                    backupButton.disabled = false;
                    backupButton.textContent = '立即备份';
                }
            }

            throw new Error(errorMessage);
        }

        const result = await res.json();
        ui.updateStatus('success', '备份成功');
        ui.showToast(`备份成功！${result.fileCount} 个文件`);

        // 恢复备份按钮
        if (backupButton) {
            backupButton.disabled = false;
            backupButton.textContent = '立即备份';
        }

        // 刷新配置显示（备份时间可能已更新）
        await loadBackupConfig();

        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 3000);
    } catch (e) {
        console.error('备份失败:', e);
        ui.updateStatus('error', '备份失败');
        alert(e.message || '备份失败');

        // 恢复备份按钮
        if (backupButton) {
            backupButton.disabled = false;
            backupButton.textContent = '立即备份';
        }

        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 3000);
    }
}

export function registerBackupTools() {
    window.saveBackupConfig = saveBackupConfig;
    window.backupNow = backupNow;
    window.loadBackupConfig = loadBackupConfig;
    window.testWebDAVConnection = testWebDAVConnection;
}
