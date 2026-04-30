(function() {
    window.createAdminSystemConfigMethods = function() {
        return {
    async showSystemConfig() {
        const data = await this.api('/api/admin/system/config');
        const config = data.config;
        const fields = [
            { key: 'maxFileSize', label: '单文件限制 (MB)', value: config.maxFileSize?.value || 500 },
            { key: 'allowedFileTypes', label: '允许类型 (逗号分隔)', value: config.allowedFileTypes?.value || '', type: 'text' },
            { key: 'chunkSize', label: '上传切片 (MB)', value: config.chunkSize?.value || 1 },
            { key: 'imageCompressionEnabled', label: '启用图片压缩', value: config.imageCompressionEnabled?.value || 'true', type: 'select', opts: [['true', '启用'], ['false', '禁用']] },
            { key: 'imageCompressionQuality', label: '压缩质量 (0-100)', value: config.imageCompressionQuality?.value || 85 },
            { key: 'imageCompressionMaxWidth', label: '最大宽度 (px)', value: config.imageCompressionMaxWidth?.value || 1920 },
            { key: 'dynamicRateLimitEnabled', label: '动态限流', value: config.dynamicRateLimitEnabled?.value || 'true', type: 'select', opts: [['true', '启用'], ['false', '禁用']] }
        ];

        const inputs = fields.map(field => {
            if (field.type === 'select') {
                return `
                    <div class="admin-form-group">
                        <label>${field.label}</label>
                        <select id="sc-${field.key}" class="admin-select" autocomplete="off">
                            ${field.opts.map(option => `<option value="${option[0]}" ${field.value === option[0] ? 'selected' : ''}>${option[1]}</option>`).join('')}
                        </select>
                    </div>
                `;
            }
            return `
                <div class="admin-form-group">
                    <label>${field.label}</label>
                    <input type="${field.type || 'number'}" id="sc-${field.key}" class="admin-input" value="${field.value}" autocomplete="off">
                </div>
            `;
        }).join('');

        this.openModal('系统运行参数', `<div class="admin-form-grid">${inputs}</div>`, async () => {
            const configs = {};
            fields.forEach(field => {
                configs[field.key] = document.getElementById(`sc-${field.key}`).value;
            });
            await this.api('/api/admin/system/config', { method: 'POST', body: JSON.stringify({ configs }) });
            this.closeModal();
            alert('系统配置已更新');
        });
    },

    async loadSmtpConfig() {
        try {
            const data = await this.api('/api/admin/smtp/config');
            const config = data.config;
            document.getElementById('smtp-host').value = config.host || '';
            document.getElementById('smtp-port').value = config.port || 587;
            document.getElementById('smtp-secure').value = config.secure ? 'true' : 'false';
            document.getElementById('smtp-user').value = config.user || '';
            document.getElementById('smtp-pass').value = config.pass || '';
        } catch (e) {
            console.error('加载 SMTP 配置失败:', e);
        }
    },

    async saveSmtpConfig(event) {
        event.preventDefault();
        const config = {
            host: document.getElementById('smtp-host').value,
            port: parseInt(document.getElementById('smtp-port').value, 10) || 587,
            secure: document.getElementById('smtp-secure').value === 'true',
            user: document.getElementById('smtp-user').value,
            pass: document.getElementById('smtp-pass').value
        };

        try {
            await this.api('/api/admin/smtp/config', { method: 'POST', body: JSON.stringify(config) });
            alert('SMTP 配置已保存');
        } catch (e) {
            console.error('保存 SMTP 配置失败:', e);
        }
    },

    async testSmtpConfig() {
        const email = prompt('请输入测试邮箱地址：');
        if (!email) return;

        try {
            await this.api('/api/admin/smtp/test', { method: 'POST', body: JSON.stringify({ to: email }) });
            alert('测试邮件已发送，请检查收件箱');
        } catch (e) {
            console.error('SMTP 测试失败:', e);
        }
    },
        };
    };
})();
