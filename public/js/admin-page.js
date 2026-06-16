const Admin = {
    state: {
        currentPage: 1,
        totalPages: 1,
        userSort: { field: 'noteCount', order: 'desc' },
        timers: {},
        activeTab: 'overview',
        workspaceType: 'all',
        counts: { note: 0, event: 0, todo: 0, contact: 0 },
        memberPlans: [],
        versionStatus: null,
        updatePollTimer: null,
        sidebarCollapsed: false
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
            settings: {
                label: '系统设置',
                copy: '管理系统运行参数、自动化备份策略以及邮件通知服务。',
                actions: [
                    { label: '保存 SMTP', handler: "document.getElementById('smtp-config-form').requestSubmit()" },
                    { label: '保存备份策略', handler: "document.getElementById('backup-config-form').requestSubmit()" }
                ]
            },
            plans: {
                label: '套餐配置',
                copy: '管理会员套餐的名称、空间额度以及各层级功能开关。',
                actions: [
                    { label: '保存套餐配置', handler: 'Admin.saveMemberPlanConfigPanel()' },
                    { label: '刷新套餐配置', handler: 'Admin.loadMemberPlanConfigs(true)' }
                ]
            },
            users: {
                label: '会员用户',
                copy: '维护会员用户、调整时长并分配套餐额度与功能开关。',
                actions: [
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
            this.loadSmtpConfig(),
            this.checkVersion()
        ]);
    },

    ...window.createAdminMemberPlanMethods(),

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
                        <select class="admin-select admin-select-sm" onchange="Admin.updatePlan('${usernameJs}', this.value)">
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

    ...window.createAdminWorkspaceMethods(),

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

    formatVersionTime(value) {
        if (!value) return '';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false });
    },

    renderVersionStatus(status = {}) {
        this.state.versionStatus = status;

        const currentEl = document.getElementById('version-current');
        const latestEl = document.getElementById('version-latest');
        const tipEl = document.getElementById('version-tip');
        const copyEl = document.getElementById('version-status-copy');
        const badgeEl = document.getElementById('version-update-badge');
        const buttonEl = document.getElementById('version-update-btn');
        if (!currentEl || !latestEl || !tipEl || !copyEl || !badgeEl || !buttonEl) return;

        const latestVersion = status.latestVersion || '';
        const updateState = status.updateState || {};
        const remotePlatformText = status.remotePlatformText || (Array.isArray(status.remotePlatforms) ? status.remotePlatforms.join(' / ') : '');
        currentEl.textContent = status.currentVersion || '-';
        latestEl.textContent = latestVersion || (status.remoteError ? '获取失败' : '-');

        const dockerEl = document.getElementById('version-docker');
        const githubEl = document.getElementById('version-github');
        if (dockerEl) {
            dockerEl.textContent = status.dockerVersion || (status.dockerError ? '获取失败' : '-');
            if (status.dockerError) {
                dockerEl.title = status.dockerError;
                dockerEl.style.color = 'var(--text-danger, #d9534f)';
            } else {
                dockerEl.removeAttribute('title');
                dockerEl.style.color = '';
            }
        }
        if (githubEl) {
            githubEl.textContent = status.githubVersion || (status.githubError ? '获取失败' : '-');
            if (status.githubError) {
                githubEl.title = status.githubError;
                githubEl.style.color = 'var(--text-danger, #d9534f)';
            } else {
                githubEl.removeAttribute('title');
                githubEl.style.color = '';
            }
        }

        badgeEl.classList.remove('update', 'ok', 'warn', 'running');
        if (updateState.running) {
            badgeEl.textContent = '更新中';
            badgeEl.classList.add('running');
            copyEl.textContent = '后台更新命令正在执行';
            buttonEl.disabled = true;
            buttonEl.textContent = '更新中';
        } else if (status.platformMatched === false) {
            badgeEl.textContent = '架构不符';
            badgeEl.classList.add('warn');
            copyEl.textContent = `当前平台 ${status.runtimePlatform || '-'} 未在远端 tag 中找到`;
            buttonEl.disabled = false;
            buttonEl.textContent = '更新提示';
        } else if (status.updateAvailable) {
            badgeEl.textContent = '有新版本';
            badgeEl.classList.add('update');
            copyEl.textContent = `可更新到 ${latestVersion}`;
            buttonEl.disabled = false;
            buttonEl.textContent = status.updateEnabled ? '自动更新' : '更新提示';
        } else if (status.remoteError) {
            badgeEl.textContent = '检查失败';
            badgeEl.classList.add('warn');
            copyEl.textContent = '暂时无法获取远端版本';
            buttonEl.disabled = true;
            buttonEl.textContent = '自动更新';
        } else if (latestVersion && status.comparable === false) {
            badgeEl.textContent = '需确认';
            badgeEl.classList.add('warn');
            copyEl.textContent = `远端 tag 为 ${latestVersion}`;
            buttonEl.disabled = false;
            buttonEl.textContent = status.updateEnabled ? '自动更新' : '更新提示';
        } else if (latestVersion) {
            badgeEl.textContent = '已是最新';
            badgeEl.classList.add('ok');
            copyEl.textContent = '当前版本已同步到最新 tag';
            buttonEl.disabled = true;
            buttonEl.textContent = '自动更新';
        } else {
            badgeEl.textContent = '未检查';
            copyEl.textContent = '点击“检查更新”按钮获取最新版本';
            buttonEl.disabled = true;
            buttonEl.textContent = '自动更新';
        }

        const publishedText = this.formatVersionTime(status.publishedAt);
        if (status.remoteError) {
            tipEl.textContent = `检查失败：${status.remoteError}`;
        } else if (status.updateAvailable) {
            tipEl.textContent = `发现新版本 ${latestVersion}，可查看更新提示。`;
        } else if (status.platformMatched === false) {
            tipEl.textContent = '当前平台未匹配远端镜像，请查看更新提示。';
        } else if (latestVersion && status.comparable === false) {
            tipEl.textContent = `远端 tag 为 ${latestVersion}，需手动确认是否更新。`;
        } else if (latestVersion) {
            tipEl.textContent = status.comparable === false ? '远端 tag 需确认。' : '版本状态正常。';
        } else {
            tipEl.textContent = '后台会从 GitHub / Docker Hub 获取最新版本。';
        }

        const titlePieces = [];
        if (status.source) titlePieces.push(`来源：${status.source}`);
        if (publishedText) titlePieces.push(`发布时间：${publishedText}`);
        if (status.runtimePlatform) titlePieces.push(`当前平台：${status.runtimePlatform}`);
        if (remotePlatformText) titlePieces.push(`远端平台：${remotePlatformText}`);
        if (!status.updateEnabled) titlePieces.push('自动更新需配置 Z7NOTE_UPDATE_COMMAND');
        buttonEl.title = titlePieces.join('\n') || (status.updateEnabled ? '执行后台配置的固定更新命令' : '查看更新提示');

        this.syncUpdatePolling(updateState.running);
    },

    async checkVersion(force = false) {
        try {
            const query = force ? '?force=1&check=1' : '';
            const status = await this.api(`/api/admin/system/version${query}`);
            this.renderVersionStatus(status);
            return status;
        } catch (e) {
            this.renderVersionStatus({
                currentVersion: this.state.versionStatus?.currentVersion || '-',
                remoteError: e.message
            });
            return null;
        }
    },

    async startSystemUpdate() {
        const status = this.state.versionStatus || {};
        const targetVersion = status.latestVersion || '';
        if (!status.updateEnabled) {
            this.showUpdateHint(status);
            return;
        }
        if (!confirm(`确认执行后台自动更新${targetVersion ? `到 ${targetVersion}` : ''}？更新过程可能会重启服务。`)) return;

        try {
            const response = await this.api('/api/admin/system/update', {
                method: 'POST',
                body: JSON.stringify({ targetVersion })
            });
            this.renderVersionStatus({
                ...status,
                updateState: response.updateState || { running: true },
                updateEnabled: true
            });
            alert('更新命令已启动。页面可能会在服务重启时短暂断开，请稍后刷新查看结果。');
        } catch (e) {
            const latestStatus = this.state.versionStatus || {};
            this.showUpdateHint(latestStatus);
        }
    },

    showUpdateHint(status = {}) {
        const hint = status.updateHint || [
            `镜像：${status.targetImage || 'hzx2185/z7note:latest'}`,
            `当前平台：${status.runtimePlatform || '-'}`,
            `远端平台：${status.remotePlatformText || (Array.isArray(status.remotePlatforms) ? status.remotePlatforms.join(' / ') : '未知')}`,
            'Docker Compose 会自动拉取当前平台对应的 amd64 / arm64 镜像。',
            '若使用 Docker 镜像部署，可在宿主机更新 compose 中的镜像 tag 后执行：docker compose pull && docker compose up -d',
            '若使用当前源码构建部署，可在宿主机执行：git pull && docker compose build && docker compose up -d',
            '如需后台按钮直接执行，请设置 Z7NOTE_UPDATE_COMMAND 为宿主环境可用的固定更新命令。'
        ].join('\n');
        alert(hint);
    },

    syncUpdatePolling(running) {
        if (!running) {
            if (this.state.updatePollTimer) {
                clearInterval(this.state.updatePollTimer);
                this.state.updatePollTimer = null;
            }
            return;
        }

        if (this.state.updatePollTimer) return;
        this.state.updatePollTimer = setInterval(async () => {
            try {
                const data = await this.api('/api/admin/system/update/status');
                const current = this.state.versionStatus || {};
                this.renderVersionStatus({
                    ...current,
                    updateState: data.updateState || {}
                });
                if (!data.updateState?.running) {
                    this.checkVersion(true);
                }
            } catch (e) {
                this.syncUpdatePolling(false);
            }
        }, 5000);
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

    ...window.createAdminSystemConfigMethods(),

    restoreTabFromHash() {
        const hash = (location.hash || '').replace('#', '');
        if (['overview', 'settings', 'plans', 'users', 'shares', 'redeem', 'content'].includes(hash)) {
            this.switchTab(hash);
        }
    },

    applySidebarCollapsed(collapsed) {
        this.state.sidebarCollapsed = collapsed;
        document.body.classList.toggle('admin-sidebar-collapsed', collapsed);
        try {
            localStorage.setItem('z7note.adminSidebarCollapsed', collapsed ? '1' : '0');
        } catch (e) {}
        const toggle = document.getElementById('adminSidebarToggle');
        if (toggle) {
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.title = collapsed ? '展开侧边栏' : '折叠侧边栏';
        }
    },

    toggleSidebar() {
        this.applySidebarCollapsed(!this.state.sidebarCollapsed);
    },

    loadSidebarState() {
        try {
            if (localStorage.getItem('z7note.adminSidebarCollapsed') === '1') {
                this.applySidebarCollapsed(true);
            }
        } catch (e) {}
    }
};

const $ = selector => document.querySelector(selector);

window.Admin = Admin;
window.$ = $;

document.addEventListener('DOMContentLoaded', () => {
    Admin.loadSidebarState();
    Admin.restoreTabFromHash();
    Admin.syncOverviewCounts();
    Admin.syncWorkspaceBatchActions();
    document.getElementById('redeem-note-limit')?.addEventListener('input', () => Admin.syncRedeemPlanPresetSummary());
    document.getElementById('redeem-file-limit')?.addEventListener('input', () => Admin.syncRedeemPlanPresetSummary());
    Admin.refreshAll();
    Admin.syncRedeemPlanPresetSummary();
});
