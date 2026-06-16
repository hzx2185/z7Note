(function() {
    window.createAdminWorkspaceMethods = function() {
        return {
    formatWorkspaceType(type) {
        return ({
            note: '笔记',
            event: '日历',
            todo: '待办',
            contact: '联系人'
        })[type] || type || '-';
    },

    updateWorkspaceCountBadges(counts = {}, total = 0) {
        this.state.counts = {
            note: counts.note || 0,
            event: counts.event || 0,
            todo: counts.todo || 0,
            contact: counts.contact || 0
        };
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        setText('workspace-count-all', `全部 ${total}`);
        setText('workspace-count-note', `笔记 ${counts.note || 0}`);
        setText('workspace-count-event', `事件 ${counts.event || 0}`);
        setText('workspace-count-todo', `待办 ${counts.todo || 0}`);
        setText('workspace-count-contact', `联系人 ${counts.contact || 0}`);
        this.syncOverviewCounts();
    },

    async loadWorkspaceOverview() {
        const search = document.getElementById('workspaceSearch').value;
        const data = await this.api(`/api/admin/workspace/overview?limit=8&search=${encodeURIComponent(search)}`);
        document.getElementById('workspaceUserSummary').innerHTML = data.users.map(user => {
            const usernameHtml = this.escapeHtml(user.username);
            const usernameJs = this.escapeJsString(user.username);
            return `
                <tr>
                    <td data-label="用户"><strong>${usernameHtml}</strong></td>
                    <td data-label="总数">${user.totalCount || 0}</td>
                    <td data-label="笔记">${user.noteCount || 0}</td>
                    <td data-label="事件">${user.eventCount || 0}</td>
                    <td data-label="待办">${user.todoCount || 0}</td>
                    <td data-label="联系人">${user.contactCount || 0}</td>
                    <td data-label="最近更新">${this.formatDateTime(user.lastUpdatedAt)}</td>
                    <td data-label="操作">
                        <div class="admin-tight-actions">
                            <button class="tool-btn" onclick="Admin.filterWorkspaceByUser('${usernameJs}')">筛选</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('') || `<tr><td colspan="8" class="admin-empty">暂无用户内容概览</td></tr>`;
    },

    async loadWorkspace(page = 1) {
        const search = document.getElementById('workspaceSearch').value;
        const type = this.state.workspaceType;
        const data = await this.api(`/api/admin/workspace/all?page=${page}&limit=15&type=${encodeURIComponent(type)}&search=${encodeURIComponent(search)}`);
        this.state.currentPage = data.page;
        this.state.totalPages = data.totalPages;

        this.updateWorkspaceCountBadges(data.counts, data.total);

        document.getElementById('workspaceList').innerHTML = data.items.map(item => {
            const usernameHtml = this.escapeHtml(item.username);
            const titleHtml = this.escapeHtml(item.title || '(无标题)');
            const typeHtml = this.escapeHtml(this.formatWorkspaceType(item.type));
            const statusHtml = this.escapeHtml(item.status || '-');
            const previewHtml = this.escapeHtml(item.preview || '-');
            const idHtml = this.escapeHtml(item.id);
            const idJs = this.escapeJsString(item.id);
            const usernameJs = this.escapeJsString(item.username);
            const typeJs = this.escapeJsString(item.type);
            return `
                <tr>
                    <td data-label="选择"><input type="checkbox" class="workspace-cb" data-id="${idHtml}" data-type="${this.escapeHtml(item.type)}" data-username="${usernameHtml}" onchange="Admin.syncWorkspaceBatchActions()"></td>
                    <td data-label="用户">${usernameHtml}</td>
                    <td data-label="标题" title="${titleHtml}">${titleHtml}</td>
                    <td data-label="类型"><span class="admin-user-badge">${typeHtml}</span></td>
                    <td data-label="状态">${statusHtml}</td>
                    <td data-label="更新时间">${this.formatDate(item.updatedAt)}</td>
                    <td data-label="摘要" title="${previewHtml}">${previewHtml}</td>
                    <td data-label="操作">
                        <div class="admin-tight-actions">
                            <button class="tool-btn" onclick="Admin.previewWorkspaceItem('${typeJs}', '${idJs}', '${usernameJs}')">查看</button>
                            <button class="tool-btn admin-danger" onclick="Admin.deleteWorkspaceItem('${typeJs}', '${idJs}', '${usernameJs}', '${this.escapeJsString(item.title || '')}')">删除</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('') || `<tr><td colspan="8" class="admin-empty">暂无匹配内容</td></tr>`;

        document.getElementById('workspacePageInfo').textContent = `第 ${data.page} / ${data.totalPages || 1} 页`;
        document.getElementById('workspacePrevBtn').disabled = data.page <= 1;
        document.getElementById('workspaceNextBtn').disabled = data.page >= data.totalPages;
        this.syncWorkspaceBatchActions();
        this.loadWorkspaceOverview();
    },

    renderWorkspaceDetail(detail) {
        const rows = [
            ['用户', detail.username],
            ['类型', this.formatWorkspaceType(detail.type)],
            ['状态', detail.status],
            ['创建时间', this.formatDateTime(detail.createdAt)],
            ['更新时间', this.formatDateTime(detail.updatedAt)]
        ];

        if (detail.type === 'note') {
            rows.push(['正文', detail.detail.content || '(空)']);
        }
        if (detail.type === 'event') {
            rows.push(['开始时间', this.formatDateTime(detail.detail.startTime)]);
            rows.push(['结束时间', this.formatDateTime(detail.detail.endTime)]);
            rows.push(['全天', detail.detail.allDay ? '是' : '否']);
            rows.push(['颜色', detail.detail.color || '-']);
            rows.push(['描述', detail.detail.description || '(空)']);
            rows.push(['重复规则', detail.detail.recurrence || '-']);
        }
        if (detail.type === 'todo') {
            rows.push(['优先级', detail.detail.priority || '-']);
            rows.push(['完成状态', detail.detail.completed ? '已完成' : '待处理']);
            rows.push(['开始时间', this.formatDateTime(detail.detail.startTime)]);
            rows.push(['截止时间', this.formatDateTime(detail.detail.dueDate)]);
            rows.push(['描述', detail.detail.description || '(空)']);
        }
        if (detail.type === 'contact') {
            rows.push(['公司', detail.detail.org || '-']);
            rows.push(['职位', detail.detail.jobTitle || '-']);
            rows.push(['昵称', detail.detail.nickname || '-']);
            rows.push(['生日', detail.detail.bday || '-']);
            rows.push(['网址', detail.detail.url || '-']);
            rows.push(['电话', detail.detail.tel || '-']);
            rows.push(['邮箱', detail.detail.email || '-']);
            rows.push(['备注', detail.detail.note || '(空)']);
        }

        return `
            <div class="admin-form-grid">
                <div class="admin-stat-card">
                    <div style="font-size:16px;font-weight:700;margin-bottom:6px">${this.escapeHtml(detail.title || '(无标题)')}</div>
                    <div class="admin-muted">ID: ${this.escapeHtml(detail.id)}</div>
                </div>
                ${rows.map(([label, value]) => `
                    <div class="admin-form-group">
                        <label>${this.escapeHtml(label)}</label>
                        <div class="admin-stat-card" style="white-space:pre-wrap;word-break:break-word">${this.escapeHtml(value || '-')}</div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    async previewWorkspaceItem(type, id, username) {
        const detail = await this.api(`/api/admin/workspace/${encodeURIComponent(type)}/${encodeURIComponent(id)}/detail?username=${encodeURIComponent(username)}`);
        this.openModal(`${this.formatWorkspaceType(type)}详情`, this.renderWorkspaceDetail(detail), () => {
            this.closeModal();
        });
    },

    filterWorkspaceByUser(username) {
        document.getElementById('workspaceSearch').value = username;
        this.switchTab('content');
        this.loadWorkspace(1);
    },

    async deleteWorkspaceItem(type, id, username, title = '') {
        const typeLabel = this.formatWorkspaceType(type);
        const titleText = title ? `《${title}》` : '该内容';
        if (!confirm(`彻底删除 ${username} 的${typeLabel}${titleText}？此操作不可恢复。`)) return;
        await this.api(`/api/admin/workspace/${encodeURIComponent(type)}/${encodeURIComponent(id)}?username=${encodeURIComponent(username)}`, { method: 'DELETE' });
        this.loadWorkspace(this.state.currentPage);
    },

    getSelectedWorkspaceItems() {
        return Array.from(document.querySelectorAll('.workspace-cb:checked')).map(cb => ({
            id: cb.dataset.id,
            type: cb.dataset.type,
            username: cb.dataset.username
        }));
    },

    async batchDeleteWorkspace() {
        const items = this.getSelectedWorkspaceItems();
        if (items.length === 0) {
            alert('请先选择要删除的内容');
            return;
        }
        if (!confirm(`确认批量删除选中的 ${items.length} 条内容？此操作不可恢复。`)) return;
        await this.api('/api/admin/workspace/batch-delete', {
            method: 'POST',
            body: JSON.stringify({ items })
        });
        this.loadWorkspace(this.state.currentPage);
    },

    async emptyAllTrash() {
        if (!confirm('清空全站所有用户的回收站？此操作不可逆。')) return;
        const res = await this.api('/api/admin/trash/empty-all', { method: 'DELETE' });
        alert(`已成功清理 ${res.count} 条记录`);
        this.loadWorkspace(1);
    }
        };
    };
})();
