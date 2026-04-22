const Admin = {
    state: {
        currentPage: 1,
        totalPages: 1,
        userSort: { field: 'noteCount', order: 'desc' },
        timers: {},
        activeTab: 'overview',
        workspaceType: 'all',
        counts: { note: 0, event: 0, todo: 0, contact: 0 },
        memberPlans: []
    },

    async api(url, options = {}) {
        try {
            const res = await fetch(url, {
                ...options,
                headers: { 'Content-Type': 'application/json', ...options.headers }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '请求失败');
            return data;
        } catch (e) {
            alert(e.message);
            throw e;
        }
    },

    formatSize(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let value = bytes;
        let index = 0;
        while (value >= 1024 && index < units.length - 1) {
            value /= 1024;
            index += 1;
        }
        return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
    },

    normalizeTimestamp(value) {
        const raw = Number(value);
        if (!Number.isFinite(raw) || raw <= 0) return null;
        return raw > 10000000000 ? raw : raw * 1000;
    },

    formatDate(value) {
        const ts = this.normalizeTimestamp(value);
        if (!ts) return '-';
        const date = new Date(ts);
        return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('zh-CN');
    },

    formatDateTime(value) {
        const ts = this.normalizeTimestamp(value);
        if (!ts) return '-';
        const date = new Date(ts);
        return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
    },

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    },

    escapeJsString(value) {
        return JSON.stringify(String(value ?? '')).slice(1, -1);
    },

    debounce(name, fn, ms = 500) {
        clearTimeout(this.state.timers[name]);
        this.state.timers[name] = setTimeout(() => fn.call(this), ms);
    },

    workspaceTypeLabel(type = 'all') {
        return ({
            all: '全部内容',
            note: '笔记管理',
            event: '日历事件',
            todo: '待办事项',
            contact: '通讯录管理'
        })[type] || '全部内容';
    },

    workspaceTypeTip(type = 'all') {
        return ({
            all: '统一巡检所有类型内容',
            note: '聚焦后台笔记内容、标题与正文摘要',
            event: '聚焦后台日历事件、时间与重复规则',
            todo: '聚焦后台待办状态、优先级与截止时间',
            contact: '聚焦后台联系人、组织和备注信息'
        })[type] || '统一巡检所有类型内容';
    },

    tabContextMap() {
        return {
            overview: {
                label: '总览面板',
                copy: '查看整站内容规模、后台范围和核心入口。',
                actions: [
                    { label: '查看全部内容', handler: "Admin.openContentManager('all')" },
                    { label: '刷新全站数据', handler: 'Admin.refreshAll()' }
                ]
            },
            users: {
                label: '用户与套餐',
                copy: '直接维护套餐配置、统一配额、用户套餐和账号状态。',
                actions: [
                    { label: '保存套餐配置', handler: 'Admin.saveMemberPlanConfigPanel()' },
                    { label: '新增用户', handler: 'Admin.showAddUser()' }
                ]
            },
            redeem: {
                label: '兑换与记录',
                copy: '生成兑换码、核对兑换记录，并追踪会员操作日志。',
                actions: [
                    { label: '生成兑换码', handler: 'Admin.createRedeemCode()' },
                    { label: '刷新兑换记录', handler: 'Admin.loadRedeemRedemptions()' }
                ]
            },
            shares: {
                label: '分享审计',
                copy: '集中查看活跃分享链接并执行批量撤销。',
                actions: [
                    { label: '刷新分享列表', handler: 'Admin.loadShares()' },
                    { label: '批量撤销', handler: 'Admin.batchRevokeShares()' }
                ]
            },
            content: {
                label: '内容管理',
                copy: '统一巡检笔记、日历、待办和通讯录内容，支持筛选与批量删除。',
                actions: [
                    { label: '查看全部内容', handler: "Admin.setWorkspaceType('all')" },
                    { label: '清空回收站', handler: 'Admin.emptyAllTrash()' }
                ]
            }
        };
    },

    updateCurrentContext(tab) {
        const context = this.tabContextMap()[tab];
        const labelEl = document.getElementById('admin-current-label');
        const copyEl = document.getElementById('admin-current-copy');
        const actionsEl = document.getElementById('admin-current-actions');
        if (!context || !labelEl || !copyEl || !actionsEl) return;
        labelEl.textContent = context.label;
        copyEl.textContent = context.copy;
        actionsEl.innerHTML = context.actions.map((action) => `
            <button class="admin-nav-btn" type="button" onclick="${action.handler}">${action.label}</button>
        `).join('');
    },

    switchTab(tab) {
        this.state.activeTab = tab;
        document.querySelectorAll('.admin-tab-pane').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.admin-nav-btn[data-admin-nav]').forEach(el => el.classList.remove('active'));
        document.getElementById(`tab-${tab}`)?.classList.add('active');
        document.querySelector(`.admin-nav-btn[data-admin-nav="${tab}"]`)?.classList.add('active');
        this.updateCurrentContext(tab);
        history.replaceState(null, '', `#${tab}`);
    },

    setWorkspaceType(type) {
        this.state.workspaceType = ['all', 'note', 'event', 'todo', 'contact'].includes(type) ? type : 'all';
        document.querySelectorAll('.admin-filter-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === this.state.workspaceType);
        });
        const label = this.workspaceTypeLabel(this.state.workspaceType);
        document.getElementById('content-active-copy').textContent = `当前视角：${label}`;
        document.getElementById('content-filter-label').textContent = `当前筛选：${label}`;
        document.getElementById('content-filter-tip').textContent = this.workspaceTypeTip(this.state.workspaceType);
        this.loadWorkspace(1);
    },

    openContentManager(type = 'all') {
        this.switchTab('content');
        this.setWorkspaceType(type);
    },

    syncOverviewCounts() {
        const counts = this.state.counts || {};
        const total = (counts.note || 0) + (counts.event || 0) + (counts.todo || 0) + (counts.contact || 0);
        document.getElementById('overview-total-count').textContent = `全部 ${total}`;
        document.getElementById('overview-note-count').textContent = counts.note || 0;
        document.getElementById('overview-event-count').textContent = counts.event || 0;
        document.getElementById('overview-todo-count').textContent = counts.todo || 0;
        document.getElementById('overview-contact-count').textContent = counts.contact || 0;
    },

    async refreshAll() {
        await this.loadMemberPlanConfigs();
        await Promise.all([
            this.loadDatabaseInfo(),
            this.loadUsers(),
            this.loadShares(),
            this.loadRedeemCodes(),
            this.loadRedeemRedemptions(),
            this.loadMembershipOperations(),
            this.loadWorkspace(),
            this.loadBackupConfig(),
            this.loadSmtpConfig()
        ]);
    },

    async loadMemberPlanConfigs(forceRender = false) {
        this.state.memberPlans = await this.api('/api/admin/member-plans');
        this.renderMemberPlanConfigPanel();
        this.syncRedeemPlanPresetSummary();
        if (forceRender) {
            document.getElementById('member-plan-config-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },

    getPlanConfig(planKey) {
        const normalized = String(planKey || '').toLowerCase();
        return (this.state.memberPlans || []).find(item => item.planKey === normalized) || null;
    },

    summarizePlanCapabilities(plan = {}) {
        const capabilities = plan.capabilities || {};
        const labels = [];
        if (capabilities.notesEnabled) labels.push('笔记');
        if (capabilities.calendarEnabled) labels.push('日历');
        if (capabilities.todosEnabled) labels.push('待办');
        if (capabilities.contactsEnabled) labels.push('通讯录');
        if (capabilities.attachmentsEnabled) labels.push('附件');
        if (capabilities.webdavEnabled) labels.push('WebDAV');
        if (capabilities.caldavEnabled) labels.push('CalDAV');
        if (capabilities.carddavEnabled) labels.push('CardDAV');
        if (capabilities.noteSharingEnabled || capabilities.fileSharingEnabled) labels.push('分享');
        if (capabilities.importExport) labels.push('导入导出');
        if (capabilities.remindersEnabled) labels.push('提醒');
        return labels.slice(0, 6).join(' / ') || '基础能力';
    },

    buildQuotaSummary(plan = {}, overrides = {}) {
        const noteLimit = Number.isFinite(Number(overrides.noteLimit)) && Number(overrides.noteLimit) > 0
            ? Number(overrides.noteLimit)
            : Number(plan.noteLimit || 0);
        const fileLimit = Number.isFinite(Number(overrides.fileLimit)) && Number(overrides.fileLimit) > 0
            ? Number(overrides.fileLimit)
            : Number(plan.fileLimit || 0);
        const eventLimit = Number(plan.eventLimit || 0);
        const todoLimit = Number(plan.todoLimit || 0);
        const contactLimit = Number(plan.contactLimit || 0);
        return `N ${noteLimit} / F ${fileLimit} / E ${eventLimit} / T ${todoLimit} / C ${contactLimit}`;
    },

    buildPlanMetaSummary(plan = {}, overrides = {}) {
        return {
            quota: this.buildQuotaSummary(plan, overrides),
            capability: this.summarizePlanCapabilities(plan)
        };
    },

    capabilityFieldLabels() {
        return Object.fromEntries(this.capabilityFields());
    },

    getEnabledCapabilityLabels(plan = {}) {
        const labels = this.capabilityFieldLabels();
        const capabilities = plan.capabilities || {};
        return Object.entries(capabilities)
            .filter(([, enabled]) => enabled)
            .map(([key]) => labels[key])
            .filter(Boolean);
    },

    applyRedeemPlanDefaults() {
        const selectEl = document.getElementById('redeem-plan');
        if (!selectEl) return;
        const plan = this.getPlanConfig(selectEl.value) || {};
        const noteEl = document.getElementById('redeem-note-limit');
        const fileEl = document.getElementById('redeem-file-limit');
        if (noteEl) noteEl.value = Number(plan.noteLimit || 0) || '';
        if (fileEl) fileEl.value = Number(plan.fileLimit || 0) || '';
        this.syncRedeemPlanPresetSummary();
    },

    clearRedeemQuotaOverrides() {
        const noteEl = document.getElementById('redeem-note-limit');
        const fileEl = document.getElementById('redeem-file-limit');
        if (noteEl) noteEl.value = '';
        if (fileEl) fileEl.value = '';
        this.syncRedeemPlanPresetSummary();
    },

    syncRedeemPlanPresetSummary() {
        const summaryEl = document.getElementById('redeem-plan-summary');
        const selectEl = document.getElementById('redeem-plan');
        if (!summaryEl || !selectEl) return;
        const plan = this.getPlanConfig(selectEl.value) || {};
        const noteInput = document.getElementById('redeem-note-limit');
        const fileInput = document.getElementById('redeem-file-limit');
        const noteOverride = noteInput?.value?.trim();
        const fileOverride = fileInput?.value?.trim();
        const meta = this.buildPlanMetaSummary(plan, {
            noteLimit: noteOverride,
            fileLimit: fileOverride
        });
        const noteHint = document.getElementById('redeem-note-limit-hint');
        const fileHint = document.getElementById('redeem-file-limit-hint');
        const capabilityListEl = document.getElementById('redeem-plan-capability-list');
        const enabledLabels = this.getEnabledCapabilityLabels(plan);
        if (noteInput) {
            noteInput.placeholder = `默认 ${Number(plan.noteLimit || 0)} MB`;
        }
        if (fileInput) {
            fileInput.placeholder = `默认 ${Number(plan.fileLimit || 0)} MB`;
        }
        if (noteHint) {
            noteHint.textContent = noteOverride ? `当前覆盖为 ${noteOverride} MB` : `留空使用套餐默认值 ${Number(plan.noteLimit || 0)} MB`;
        }
        if (fileHint) {
            fileHint.textContent = fileOverride ? `当前覆盖为 ${fileOverride} MB` : `留空使用套餐默认值 ${Number(plan.fileLimit || 0)} MB`;
        }
        summaryEl.innerHTML = `
            <strong>${this.escapeHtml(this.formatPlanName(plan.planKey || selectEl.value))}</strong>
            <span class="admin-table-meta">${this.escapeHtml(meta.quota)}</span>
            <span class="admin-table-meta">${this.escapeHtml(meta.capability)}</span>
            <span class="admin-table-meta">${this.escapeHtml(plan.planSummary || '')}</span>
        `;
        if (capabilityListEl) {
            capabilityListEl.innerHTML = enabledLabels.map(label => `
                <label class="admin-checkbox">
                    <input type="checkbox" checked disabled>
                    <span>${this.escapeHtml(label)}</span>
                </label>
            `).join('') || `<span class="admin-muted">当前套餐未启用额外能力</span>`;
        }
    },

    async loadDatabaseInfo() {
        const data = await this.api('/api/admin/database/info');
        document.getElementById('db-total-size').textContent = `${data.totalSizeMB} MB`;
        document.getElementById('db-used-size').textContent = `${data.usedSizeMB} MB`;
        document.getElementById('db-free-size').textContent = `${data.freeSpaceMB || 0} MB`;
    },

    async vacuumDatabase() {
        if (!confirm('重建数据库以优化性能和回收碎片空间，可能需要几秒钟。继续？')) return;
        await this.api('/api/admin/database/vacuum', { method: 'POST' });
        alert('数据库优化完成');
        this.loadDatabaseInfo();
    },

    async loadUsers() {
        if (!Array.isArray(this.state.memberPlans) || !this.state.memberPlans.length) {
            await this.loadMemberPlanConfigs();
        }
        const { field, order } = this.state.userSort;
        const search = document.getElementById('userSearch').value;
        const users = await this.api(`/api/admin/users/stats?search=${encodeURIComponent(search)}&sort=${field}&order=${order}`);
        document.getElementById('stat-user-count').textContent = users.length;
        document.getElementById('userList').innerHTML = users.map(user => {
            const usernameHtml = this.escapeHtml(user.username);
            const emailHtml = this.escapeHtml(user.email || '未绑定邮箱');
            const usernameJs = this.escapeJsString(user.username);
            const planKey = ['free', 'pro', 'team'].includes(String(user.planKey || '').toLowerCase())
                ? String(user.planKey).toLowerCase()
                : 'free';
            const plan = this.getPlanConfig(planKey) || {};
            const noteLimit = Number.isFinite(Number(user.noteLimit)) ? Number(user.noteLimit) : 0;
            const fileLimit = Number.isFinite(Number(user.fileLimit)) ? Number(user.fileLimit) : 0;
            const quotaSummary = this.buildQuotaSummary(plan, { noteLimit, fileLimit });
            const capabilitySummary = this.summarizePlanCapabilities(plan);
            return `
                <tr>
                    <td data-label="用户">
                        <strong>${usernameHtml}</strong>
                        <span class="admin-table-meta">${emailHtml}</span>
                    </td>
                    <td data-label="存储数据概览">
                        <div class="admin-user-badges">
                            <span class="admin-user-badge ${user.noteCount ? 'active' : ''}" title="笔记数量">N ${user.noteCount}</span>
                            <span class="admin-user-badge ${user.eventCount ? 'active' : ''}" title="日程数量">E ${user.eventCount}</span>
                            <span class="admin-user-badge ${user.todoCount ? 'active' : ''}" title="待办数量">T ${user.todoCount}</span>
                            <span class="admin-user-badge ${user.contactCount ? 'active' : ''}" title="联系人数量">C ${user.contactCount}</span>
                        </div>
                    </td>
                    <td data-label="套餐">
                        <select class="admin-select" style="width:96px;min-height:32px" onchange="Admin.updatePlan('${usernameJs}', this.value)">
                            <option value="free" ${planKey === 'free' ? 'selected' : ''}>Free</option>
                            <option value="pro" ${planKey === 'pro' ? 'selected' : ''}>Pro</option>
                            <option value="team" ${planKey === 'team' ? 'selected' : ''}>Team</option>
                        </select>
                    </td>
                    <td data-label="会员有效期">${user.planExpiresAt ? this.formatDateTime(user.planExpiresAt) : '永久'}</td>
                    <td data-label="DB 占用">${this.formatSize(user.dbSize)}</td>
                    <td data-label="附件占用">${this.formatSize(user.attachmentSize)}</td>
                    <td data-label="套餐额度 / 功能">
                        <strong>${this.escapeHtml(quotaSummary)}</strong>
                        <span class="admin-table-meta">${this.escapeHtml(capabilitySummary)}</span>
                    </td>
                    <td data-label="操作">
                        <div class="admin-tight-actions">
                            <button class="tool-btn" onclick="Admin.adjustMembershipDays('${usernameJs}', '${planKey}')">时长</button>
                            <button class="tool-btn" onclick="Admin.showResetPass('${usernameJs}')">改密</button>
                            <button class="tool-btn admin-danger" onclick="Admin.deleteUser('${usernameJs}')">删除</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('') || `<tr><td colspan="8" class="admin-empty">暂无匹配用户</td></tr>`;
    },

    sortUsers(field) {
        this.state.userSort.order = (this.state.userSort.field === field && this.state.userSort.order === 'asc') ? 'desc' : 'asc';
        this.state.userSort.field = field;
        this.loadUsers();
    },

    async updatePlan(username, planKey) {
        await this.api('/api/admin/users/update-plan', {
            method: 'POST',
            body: JSON.stringify({ username, planKey })
        });
        this.loadUsers();
        this.loadMembershipOperations();
    },

    async adjustMembershipDays(username, planKey) {
        const normalizedPlanKey = String(planKey || '').toLowerCase();
        if (normalizedPlanKey === 'free') {
            alert('Free 套餐没有会员时长可调整，请先切到 Pro / Team。');
            return;
        }

        const raw = prompt(`为用户 ${username} 调整会员天数。\n\n输入正数表示延长，负数表示扣减。\n示例：30 或 -7`, '30');
        if (raw === null) return;

        const deltaDays = parseInt(String(raw).trim(), 10);
        if (!Number.isFinite(deltaDays) || deltaDays === 0) {
            alert('请输入非 0 整数天数');
            return;
        }

        const response = await this.api('/api/admin/users/adjust-membership', {
            method: 'POST',
            body: JSON.stringify({ username, deltaDays })
        });
        const membership = response.membership || {};
        alert(`会员时长已调整。当前套餐：${membership.planName || membership.planKey || '-'}；有效期：${membership.planExpiresAt ? this.formatDateTime(membership.planExpiresAt) : '永久'}`);
        this.loadUsers();
        this.loadMembershipOperations();
    },

    async deleteUser(username) {
        if (!confirm(`警告：彻底删除用户 "${username}" 及其所有数据？不可恢复。`)) return;
        await this.api(`/api/admin/users/${username}`, { method: 'DELETE' });
        this.loadUsers();
        this.loadWorkspace(this.state.currentPage);
    },

    async loadShares() {
        const shares = await this.api('/api/share/list');
        const now = Date.now();
        document.getElementById('shareList').innerHTML = shares.map(share => {
            const isExpired = share.expiresAt && now > share.expiresAt;
            const title = share.targetType === 'note' ? (share.noteTitle || share.target) : share.target.split('/').pop();
            const ownerHtml = this.escapeHtml(share.owner);
            const titleHtml = this.escapeHtml(title);
            const tokenHtml = this.escapeHtml(share.token);
            const tokenJs = this.escapeJsString(share.token);
            return `
                <tr>
                    <td data-label="选择"><input type="checkbox" class="share-cb" value="${tokenHtml}"></td>
                    <td data-label="所有者">${ownerHtml}</td>
                    <td data-label="内容标题" title="${titleHtml}">${titleHtml}</td>
                    <td data-label="类型"><span class="admin-user-badge">${share.targetType === 'note' ? '笔记' : '文件'}</span></td>
                    <td data-label="创建时间">${this.formatDate(share.createdAt)}</td>
                    <td data-label="有效期" class="${isExpired ? 'admin-danger' : ''}">${share.expiresAt ? this.formatDate(share.expiresAt) : '永久'}</td>
                    <td data-label="操作">
                        <div class="admin-tight-actions">
                            <button class="tool-btn" onclick="Admin.revokeShare('${tokenJs}')">撤销</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('') || `<tr><td colspan="7" class="admin-empty">暂无活跃分享</td></tr>`;
    },

    async revokeShare(token) {
        if (!confirm('确定撤销此分享？')) return;
        await this.api('/api/share/revoke', { method: 'POST', body: JSON.stringify({ token }) });
        this.loadShares();
    },

    formatPlanName(planKey) {
        return ({
            free: 'Free',
            pro: 'Pro',
            team: 'Team'
        })[String(planKey || '').toLowerCase()] || '-';
    },

    datetimeLocalToTimestamp(value) {
        if (!value) return 0;
        const date = new Date(value);
        const timestamp = Math.floor(date.getTime() / 1000);
        return Number.isFinite(timestamp) ? timestamp : 0;
    },

    async createRedeemCode() {
        const resultEl = document.getElementById('redeem-create-result');
        resultEl.textContent = '';

        const payload = {
            code: document.getElementById('redeem-custom-code').value.trim(),
            planKey: document.getElementById('redeem-plan').value,
            noteLimit: document.getElementById('redeem-note-limit').value.trim(),
            fileLimit: document.getElementById('redeem-file-limit').value.trim(),
            durationDays: document.getElementById('redeem-duration-days').value.trim(),
            maxRedemptions: document.getElementById('redeem-max-redemptions').value,
            count: document.getElementById('redeem-batch-count').value,
            expiresAt: this.datetimeLocalToTimestamp(document.getElementById('redeem-expires-at').value)
        };

        const response = await this.api('/api/admin/redeem-codes', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response.redeemCodes?.length) {
            resultEl.textContent = `已批量生成 ${response.redeemCodes.length} 个兑换码：${response.redeemCodes.map(item => item.code).join(' ')}`;
        } else {
            resultEl.textContent = `已生成兑换码：${response.redeemCode.code}`;
        }
        document.getElementById('redeem-custom-code').value = '';
        this.loadRedeemCodes();
        this.loadRedeemRedemptions();
        this.loadMembershipOperations();
    },

    async loadRedeemCodes() {
        if (!Array.isArray(this.state.memberPlans) || !this.state.memberPlans.length) {
            await this.loadMemberPlanConfigs();
        }
        const codes = await this.api('/api/admin/redeem-codes');
        const now = Math.floor(Date.now() / 1000);

        document.getElementById('redeemCodeList').innerHTML = codes.map(item => {
            const expired = item.expiresAt && item.expiresAt < now;
            const usage = `${item.redeemedCount || 0} / ${item.maxRedemptions || 0}`;
            const plan = this.getPlanConfig(item.planKey) || {};
            const meta = this.buildPlanMetaSummary(plan, { noteLimit: item.noteLimit, fileLimit: item.fileLimit });
            const duration = Number(item.durationDays || 0) > 0 ? `${item.durationDays} 天` : '永久';
            return `
                <tr>
                    <td data-label="兑换码"><strong>${this.escapeHtml(item.code)}</strong><span class="admin-table-meta">${this.escapeHtml(item.createdBy || '-')}</span></td>
                    <td data-label="套餐">${this.escapeHtml(this.formatPlanName(item.planKey))}</td>
                    <td data-label="时长">${this.escapeHtml(duration)}</td>
                    <td data-label="配额"><strong>${this.escapeHtml(meta.quota)}</strong><span class="admin-table-meta">${this.escapeHtml(meta.capability)}</span></td>
                    <td data-label="使用情况">${this.escapeHtml(usage)}</td>
                    <td data-label="过期时间">${item.expiresAt ? this.formatDateTime(item.expiresAt) : '永久'}</td>
                    <td data-label="状态">
                        <span class="admin-user-badge ${item.enabled && !expired ? 'active' : ''}">
                            ${expired ? '已过期' : (item.enabled ? '启用中' : '已停用')}
                        </span>
                    </td>
                    <td data-label="操作">
                        <div class="admin-tight-actions">
                            <button class="tool-btn" onclick="Admin.toggleRedeemCode('${this.escapeJsString(item.code)}', ${item.enabled ? 'false' : 'true'})">
                                ${item.enabled ? '停用' : '启用'}
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('') || `<tr><td colspan="8" class="admin-empty">暂无兑换码</td></tr>`;
    },

    async toggleRedeemCode(code, enabled) {
        await this.api(`/api/admin/redeem-codes/${encodeURIComponent(code)}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ enabled })
        });
        this.loadRedeemCodes();
    },

    async loadRedeemRedemptions() {
        if (!Array.isArray(this.state.memberPlans) || !this.state.memberPlans.length) {
            await this.loadMemberPlanConfigs();
        }
        const search = document.getElementById('redeemRedemptionSearch')?.value || '';
        const items = await this.api(`/api/admin/redeem-codes/redemptions?search=${encodeURIComponent(search)}&limit=100`);
        document.getElementById('redeemRedemptionList').innerHTML = items.map(item => {
            const plan = this.getPlanConfig(item.planKey) || {};
            const meta = this.buildPlanMetaSummary(plan, { noteLimit: item.noteLimit, fileLimit: item.fileLimit });
            return `
                <tr>
                    <td data-label="用户"><strong>${this.escapeHtml(item.username)}</strong></td>
                    <td data-label="兑换码">${this.escapeHtml(item.code)}</td>
                    <td data-label="套餐">${this.escapeHtml(this.formatPlanName(item.planKey))}</td>
                    <td data-label="会员到期">${item.planExpiresAt ? this.formatDateTime(item.planExpiresAt) : '永久'}</td>
                    <td data-label="配额"><strong>${this.escapeHtml(meta.quota)}</strong><span class="admin-table-meta">${this.escapeHtml(meta.capability)}</span></td>
                    <td data-label="兑换时间">${this.formatDateTime(item.redeemedAt)}</td>
                </tr>
            `;
        }).join('') || `<tr><td colspan="6" class="admin-empty">暂无兑换记录</td></tr>`;
    },

    formatMembershipAction(action) {
        return ({
            redeem: '兑换码兑换',
            adjust_days: '调整时长',
            set_plan: '切换套餐',
            expired_downgrade: '到期降级'
        })[String(action || '').toLowerCase()] || (action || '-');
    },

    formatMembershipOperationDetails(item) {
        const parts = [];
        const plan = this.getPlanConfig(item.planKey) || {};
        if (Number(item.durationDays || 0)) {
            parts.push(`时长 ${Number(item.durationDays) > 0 ? '+' : ''}${item.durationDays} 天`);
        }
        if (item.source) {
            parts.push(`来源 ${item.source}`);
        }
        if (item.noteLimit || item.fileLimit || plan.eventLimit || plan.todoLimit || plan.contactLimit) {
            parts.push(`配额 ${this.buildQuotaSummary(plan, { noteLimit: item.noteLimit, fileLimit: item.fileLimit })}`);
        }
        const capabilitySummary = this.summarizePlanCapabilities(plan);
        if (capabilitySummary) {
            parts.push(`能力 ${capabilitySummary}`);
        }

        if (item.details) {
            try {
                const meta = JSON.parse(item.details);
                if (meta.previousPlanKey) {
                    parts.push(`原套餐 ${this.formatPlanName(meta.previousPlanKey)}`);
                }
                if (meta.previousPlanExpiresAt) {
                    parts.push(`原到期 ${this.formatDateTime(meta.previousPlanExpiresAt)}`);
                }
                if (meta.result === 'downgraded_to_free') {
                    parts.push('结果 已降级为 Free');
                }
            } catch {}
        }

        return parts.join('；') || '-';
    },

    async loadMembershipOperations() {
        if (!Array.isArray(this.state.memberPlans) || !this.state.memberPlans.length) {
            await this.loadMemberPlanConfigs();
        }
        const search = document.getElementById('membershipOperationSearch')?.value || '';
        const items = await this.api(`/api/admin/membership-operations?search=${encodeURIComponent(search)}&limit=100`);
        document.getElementById('membershipOperationList').innerHTML = items.map(item => `
            <tr>
                <td data-label="时间">${this.formatDateTime(item.createdAt)}</td>
                <td data-label="用户"><strong>${this.escapeHtml(item.username)}</strong></td>
                <td data-label="动作">${this.escapeHtml(this.formatMembershipAction(item.action))}</td>
                <td data-label="操作人">${this.escapeHtml(item.operator || '-')}</td>
                <td data-label="套餐 / 到期">${this.escapeHtml(this.formatPlanName(item.planKey))}<span class="admin-table-meta">${item.planExpiresAt ? this.formatDateTime(item.planExpiresAt) : '永久'}</span></td>
                <td data-label="兑换码">${this.escapeHtml(item.redeemCode || '-')}</td>
                <td data-label="详情" title="${this.escapeHtml(this.formatMembershipOperationDetails(item))}">${this.escapeHtml(this.formatMembershipOperationDetails(item))}</td>
            </tr>
        `).join('') || `<tr><td colspan="7" class="admin-empty">暂无会员操作日志</td></tr>`;
    },

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
        document.getElementById('workspace-count-all').textContent = `全部 ${total}`;
        document.getElementById('workspace-count-note').textContent = `笔记 ${counts.note || 0}`;
        document.getElementById('workspace-count-event').textContent = `事件 ${counts.event || 0}`;
        document.getElementById('workspace-count-todo').textContent = `待办 ${counts.todo || 0}`;
        document.getElementById('workspace-count-contact').textContent = `联系人 ${counts.contact || 0}`;
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
    },

    async loadBackupConfig() {
        const config = await this.api('/api/admin/backup/config');
        if (!config.id) return;
        const scheduleEl = document.getElementById('bc-schedule');
        const isPreset = ['none', '0 0 * * *', '0 0 * * 0', '0 */6 * * *', '0 */12 * * *'].includes(config.schedule);
        scheduleEl.value = isPreset ? (config.schedule || 'none') : 'custom';
        this.toggleCustomSchedule(scheduleEl);
        if (!isPreset) document.getElementById('bc-schedule-custom').value = config.schedule;

        document.getElementById('bc-backupMode').value = config.backupMode || 'incremental';
        document.getElementById('bc-keepCount').value = config.keepCount || 0;
        document.getElementById('bc-webdavUrl').value = config.webdavUrl || '';
        document.getElementById('bc-webdavUser').value = config.webdavUser || '';
        document.getElementById('bc-webdavPassword').value = config.webdavPassword || '';
        document.getElementById('bc-emailAddress').value = config.emailAddress || '';
        document.getElementById('bc-useWebDAV').checked = !!config.useWebDAV;
        document.getElementById('bc-sendEmail').checked = !!config.sendEmail;
        document.getElementById('bc-attachments').checked = !!config.includeAttachments;
    },

    toggleCustomSchedule(el) {
        document.getElementById('bc-schedule-custom-container').style.display = el.value === 'custom' ? 'block' : 'none';
    },

    async saveBackupConfig(event) {
        event.preventDefault();
        const schedule = document.getElementById('bc-schedule').value === 'custom'
            ? document.getElementById('bc-schedule-custom').value.trim()
            : document.getElementById('bc-schedule').value;

        await this.api('/api/admin/backup/config', {
            method: 'POST',
            body: JSON.stringify({
                schedule,
                backupMode: document.getElementById('bc-backupMode').value,
                keepCount: parseInt(document.getElementById('bc-keepCount').value, 10) || 0,
                webdavUrl: document.getElementById('bc-webdavUrl').value,
                webdavUser: document.getElementById('bc-webdavUser').value,
                webdavPassword: document.getElementById('bc-webdavPassword').value,
                emailAddress: document.getElementById('bc-emailAddress').value,
                useWebDAV: document.getElementById('bc-useWebDAV').checked,
                sendEmail: document.getElementById('bc-sendEmail').checked,
                includeAttachments: document.getElementById('bc-attachments').checked
            })
        });
        alert('备份策略已更新');
    },

    async backupNow() {
        if (!confirm('立即执行一次全系统备份并根据配置同步到 WebDAV？')) return;
        await this.api('/api/admin/backup/now', { method: 'POST' });
        alert('备份任务已在后台启动，完成后会根据设置发送邮件通知。');
    },

    selectAll(cls, checked) {
        document.querySelectorAll(`.${cls}`).forEach(cb => { cb.checked = checked; });
        if (cls === 'workspace-cb') this.syncWorkspaceBatchActions();
    },

    syncWorkspaceBatchActions() {
        const hasChecked = document.querySelectorAll('.workspace-cb:checked').length > 0;
        document.getElementById('workspace-batch-actions').style.visibility = hasChecked ? 'visible' : 'hidden';
    },

    changePage(delta) {
        const target = this.state.currentPage + delta;
        if (target >= 1 && target <= this.state.totalPages) this.loadWorkspace(target);
    },

    async batchRevokeShares() {
        const tokens = Array.from(document.querySelectorAll('.share-cb:checked')).map(cb => cb.value);
        if (tokens.length === 0) {
            alert('请先选择要撤销的分享');
            return;
        }
        if (!confirm(`确认撤销选中的 ${tokens.length} 个分享链接？`)) return;
        await Promise.all(tokens.map(token => this.api('/api/share/revoke', {
            method: 'POST',
            body: JSON.stringify({ token })
        })));
        this.loadShares();
    },

    openModal(title, html, onConfirm) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalInputs').innerHTML = html;
        this.state.onModalConfirm = onConfirm;
        document.getElementById('modal').classList.add('show');
    },

    closeModal() {
        document.getElementById('modal').classList.remove('show');
    },

    handleModalSubmit(event) {
        event.preventDefault();
        if (this.state.onModalConfirm) this.state.onModalConfirm();
    },

    showAddUser() {
        this.openModal('新增系统用户', `
            <div class="admin-form-grid">
                <div class="admin-form-group"><label>用户名</label><input type="text" id="m-u" class="admin-input" autocomplete="off" required></div>
                <div class="admin-form-group"><label>安全邮箱</label><input type="email" id="m-e" class="admin-input" autocomplete="off" required></div>
                <div class="admin-form-group"><label>初始密码</label><input type="password" id="m-p" class="admin-input" autocomplete="new-password" required></div>
            </div>
        `, async () => {
            await this.api('/api/admin/users/add', {
                method: 'POST',
                body: JSON.stringify({
                    username: $('#m-u').value,
                    email: $('#m-e').value,
                    password: $('#m-p').value
                })
            });
            this.closeModal();
            this.loadUsers();
        });
    },

    showResetPass(username) {
        this.openModal(`重置用户密码: ${username}`, `
            <div class="admin-form-group">
                <label>新密码</label>
                <input type="password" id="m-p" class="admin-input" autocomplete="new-password" required>
            </div>
        `, async () => {
            await this.api('/api/admin/users/reset-password', {
                method: 'POST',
                body: JSON.stringify({ username, newPassword: $('#m-p').value })
            });
            this.closeModal();
            alert('密码已重置');
        });
    },

    capabilityFields() {
        return [
            ['notesEnabled', '笔记'],
            ['calendarEnabled', '日历'],
            ['todosEnabled', '待办'],
            ['contactsEnabled', '通讯录'],
            ['attachmentsEnabled', '附件上传'],
            ['attachmentPreviewEnabled', '附件预览'],
            ['attachmentManageEnabled', '附件管理'],
            ['noteSharingEnabled', '笔记分享'],
            ['fileSharingEnabled', '附件分享'],
            ['importExport', '导入导出'],
            ['backupExportEnabled', '备份导出'],
            ['remindersEnabled', '提醒中心'],
            ['emailRemindersEnabled', '邮件提醒'],
            ['browserRemindersEnabled', '浏览器提醒'],
            ['caldavRemindersEnabled', 'CalDAV 提醒'],
            ['calendarSubscriptionsEnabled', '日历订阅'],
            ['webdavEnabled', 'WebDAV'],
            ['caldavEnabled', 'CalDAV'],
            ['carddavEnabled', 'CardDAV'],
            ['searchEnabled', '全局搜索'],
            ['advancedSharing', '高级分享'],
            ['teamWorkspace', '团队协作'],
            ['adminWorkbench', '管理后台']
        ];
    },

    renderMemberPlanConfigPanel() {
        const container = document.getElementById('member-plan-config-panel');
        if (!container) return;
        const plans = Array.isArray(this.state.memberPlans) ? this.state.memberPlans : [];
        if (!plans.length) {
            container.innerHTML = '<div class="admin-empty">暂无套餐配置</div>';
            return;
        }
        container.innerHTML = plans.map((plan) => {
            const planKey = this.escapeHtml(plan.planKey);
            const capabilityInputs = this.capabilityFields().map(([key, label]) => `
                <label class="admin-checkbox">
                    <input type="checkbox" id="mp-${planKey}-${key}" ${plan.capabilities?.[key] ? 'checked' : ''}>
                    <span>${label}</span>
                </label>
            `).join('');
            return `
                <section class="admin-plan-card" data-plan="${planKey}">
                    <div class="admin-section-head">
                        <div>
                            <h3 class="admin-section-title">${this.escapeHtml(plan.planName)}</h3>
                            <p class="admin-section-kicker">${this.escapeHtml(plan.planKey.toUpperCase())} 套餐默认配置</p>
                        </div>
                    </div>
                    <div class="admin-form-grid two">
                        <div class="admin-form-group">
                            <label>显示名称</label>
                            <input type="text" id="mp-${planKey}-name" class="admin-input" value="${this.escapeHtml(plan.planName || '')}" autocomplete="off">
                        </div>
                        <div class="admin-form-group">
                            <label>徽标文案</label>
                            <input type="text" id="mp-${planKey}-badge" class="admin-input" value="${this.escapeHtml(plan.planBadge || '')}" autocomplete="off">
                        </div>
                        <div class="admin-form-group">
                            <label>笔记空间 (MB)</label>
                            <input type="number" min="1" id="mp-${planKey}-note" class="admin-input" value="${Number(plan.noteLimit || 0)}" autocomplete="off">
                        </div>
                        <div class="admin-form-group">
                            <label>附件空间 (MB)</label>
                            <input type="number" min="1" id="mp-${planKey}-file" class="admin-input" value="${Number(plan.fileLimit || 0)}" autocomplete="off">
                        </div>
                        <div class="admin-form-group">
                            <label>事件数量上限</label>
                            <input type="number" min="1" id="mp-${planKey}-event" class="admin-input" value="${Number(plan.eventLimit || 0)}" autocomplete="off">
                        </div>
                        <div class="admin-form-group">
                            <label>待办数量上限</label>
                            <input type="number" min="1" id="mp-${planKey}-todo" class="admin-input" value="${Number(plan.todoLimit || 0)}" autocomplete="off">
                        </div>
                        <div class="admin-form-group">
                            <label>联系人数量上限</label>
                            <input type="number" min="1" id="mp-${planKey}-contact" class="admin-input" value="${Number(plan.contactLimit || 0)}" autocomplete="off">
                        </div>
                    </div>
                    <div class="admin-form-group" style="margin-top:10px">
                        <label>套餐摘要</label>
                        <textarea id="mp-${planKey}-summary" class="admin-textarea" autocomplete="off">${this.escapeHtml(plan.planSummary || '')}</textarea>
                    </div>
                    <div class="admin-form-group" style="margin-top:10px">
                        <label>权益条目（每行一个）</label>
                        <textarea id="mp-${planKey}-features" class="admin-textarea" autocomplete="off">${this.escapeHtml((plan.features || []).join('\n'))}</textarea>
                    </div>
                    <div class="admin-form-group" style="margin-top:10px">
                        <label>功能开关（按模块 / 协议 / 能力统一配置）</label>
                        <div class="admin-checkbox-list">${capabilityInputs}</div>
                    </div>
                </section>
            `;
        }).join('');
    },

    collectMemberPlanPayload() {
        const payload = {};
        (this.state.memberPlans || []).forEach((plan) => {
            const planKey = plan.planKey;
            const capabilities = {};
            this.capabilityFields().forEach(([key]) => {
                capabilities[key] = !!document.getElementById(`mp-${planKey}-${key}`)?.checked;
            });
            payload[planKey] = {
                planName: document.getElementById(`mp-${planKey}-name`)?.value.trim() || '',
                planBadge: document.getElementById(`mp-${planKey}-badge`)?.value.trim() || '',
                planSummary: document.getElementById(`mp-${planKey}-summary`)?.value.trim() || '',
                noteLimit: parseInt(document.getElementById(`mp-${planKey}-note`)?.value, 10) || 0,
                fileLimit: parseInt(document.getElementById(`mp-${planKey}-file`)?.value, 10) || 0,
                eventLimit: parseInt(document.getElementById(`mp-${planKey}-event`)?.value, 10) || 0,
                todoLimit: parseInt(document.getElementById(`mp-${planKey}-todo`)?.value, 10) || 0,
                contactLimit: parseInt(document.getElementById(`mp-${planKey}-contact`)?.value, 10) || 0,
                features: (document.getElementById(`mp-${planKey}-features`)?.value || '').split('\n').map(item => item.trim()).filter(Boolean),
                capabilities
            };
        });
        return payload;
    },

    async saveMemberPlanConfigPanel() {
        const payload = this.collectMemberPlanPayload();
        await this.api('/api/admin/member-plans', {
            method: 'POST',
            body: JSON.stringify({ plans: payload })
        });
        alert('套餐配置已更新。后续用户切换套餐、兑换码默认配额和会员摘要会使用新配置。');
        await this.loadMemberPlanConfigs();
        this.loadUsers();
    },

    showMemberPlanConfig() {
        this.switchTab('users');
        document.getElementById('member-plan-config-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

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

    restoreTabFromHash() {
        const hash = (location.hash || '').replace('#', '');
        if (['overview', 'users', 'shares', 'redeem', 'content'].includes(hash)) {
            this.switchTab(hash);
        }
    }
};

const $ = selector => document.querySelector(selector);

window.Admin = Admin;
window.$ = $;

document.addEventListener('DOMContentLoaded', () => {
    Admin.restoreTabFromHash();
    Admin.syncOverviewCounts();
    Admin.syncWorkspaceBatchActions();
    document.getElementById('redeem-note-limit')?.addEventListener('input', () => Admin.syncRedeemPlanPresetSummary());
    document.getElementById('redeem-file-limit')?.addEventListener('input', () => Admin.syncRedeemPlanPresetSummary());
    Admin.refreshAll();
    Admin.syncRedeemPlanPresetSummary();
});
