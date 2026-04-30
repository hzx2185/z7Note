(function() {
    window.createAdminMemberPlanMethods = function() {
        return {
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
        };
    };
})();
