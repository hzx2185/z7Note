import { loadBackupConfig, registerBackupTools } from './tools-backup.js?v=1.0.15';
// 工具函数模块
const ToolsManager = {
    // 打开附件管理页面（替代原来的下拉菜单）
    openAttachmentManager() {
        // 调用 API 打开附件管理模态框
        api.loadAttachments();
    },

    // 打开备份配置
    openBackupConfig() {
        const modal = document.getElementById('backup-modal');
        if (!modal) return;
        modal.classList.add('show');
        loadBackupConfig();
    },

    _toolbarGroups: [
        { id: 'common', label: '常用' },
        { id: 'line', label: '行操作' },
        { id: 'format', label: '格式' },
        { id: 'insert', label: '插入' },
        { id: 'view', label: '视图' },
        { id: 'tools', label: '工具' }
    ],
    _toolbarPrimaryGroupId: 'common',
    _toolbarLayoutEndpoint: '/api/user/toolbar-layout',
    _defaultToolbarLayout: null,
    _serverToolbarLayoutLoaded: false,
    _toolbarLayoutRequest: null,

    _toolbarStorageKey() {
        const username = localStorage.getItem('z7note_username') || localStorage.getItem('username') || 'guest';
        return `z7note_toolbar_layout:${username}`;
    },

    _cssEscape(value) {
        if (window.CSS?.escape) return CSS.escape(value);
        return String(value).replace(/["\\]/g, '\\$&');
    },

    _getToolbarElement() {
        return document.querySelector('.quick-tools.workspace-brand-toolbar');
    },

    _getToolbarGroups() {
        return Array.from(document.querySelectorAll('.quick-tools [data-toolbar-group]'));
    },

    _getToolbarItems() {
        return Array.from(document.querySelectorAll('.quick-tools [data-toolbar-item]'));
    },

    _readGroupedToolbarLayoutFromDom() {
        return this._getToolbarGroups().map((group) => ({
            group: group.dataset.toolbarGroup,
            items: Array.from(group.querySelectorAll('[data-toolbar-item]')).map((item) => ({
                id: item.dataset.toolbarItem,
                visible: item.dataset.toolbarItem === 'toolbarSettings' || item.dataset.toolbarHidden !== 'true'
            }))
        }));
    },

    _cloneToolbarLayout(layout) {
        return Array.isArray(layout) ? JSON.parse(JSON.stringify(layout)) : null;
    },

    _escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    },

    _normalizeToolbarItem(rawItem) {
        const id = typeof rawItem === 'string'
            ? rawItem
            : (typeof rawItem?.id === 'string' ? rawItem.id : '');
        if (!id) return null;
        return {
            id,
            visible: id === 'toolbarSettings' || !(typeof rawItem === 'object' && rawItem?.visible === false)
        };
    },

    _getToolbarGroupLabel(groupId) {
        return this._toolbarGroups.find((group) => group.id === groupId)?.label || groupId || '工具';
    },

    _getToolbarDefaultGroupByItem() {
        const groupByItem = new Map();
        const source = Array.isArray(this._defaultToolbarLayout)
            ? this._defaultToolbarLayout
            : this._readGroupedToolbarLayoutFromDom();

        source.forEach((section) => {
            if (!Array.isArray(section.items)) return;
            section.items.forEach((rawItem) => {
                const normalized = this._normalizeToolbarItem(rawItem);
                if (normalized && !groupByItem.has(normalized.id)) {
                    groupByItem.set(normalized.id, section.group);
                }
            });
        });

        return groupByItem;
    },

    _getDefaultToolbarItemIds() {
        const ids = [];
        const source = Array.isArray(this._defaultToolbarLayout)
            ? this._defaultToolbarLayout
            : this._readGroupedToolbarLayoutFromDom();

        source.forEach((section) => {
            if (!Array.isArray(section.items)) return;
            section.items.forEach((rawItem) => {
                const normalized = this._normalizeToolbarItem(rawItem);
                if (normalized && !ids.includes(normalized.id)) ids.push(normalized.id);
            });
        });

        return ids;
    },

    _normalizeToolbarLayout(layout, { includeMissing = true } = {}) {
        if (!Array.isArray(layout)) return null;

        const validGroups = new Set(this._toolbarGroups.map((group) => group.id));
        const domItems = new Map(this._getToolbarItems().map((item) => [item.dataset.toolbarItem, item]));
        const items = [];
        const seenItems = new Set();
        const seenGroups = new Set();

        layout.forEach((section) => {
            const groupId = typeof section?.group === 'string' ? section.group : '';
            if (!validGroups.has(groupId) || seenGroups.has(groupId) || !Array.isArray(section.items)) return;
            seenGroups.add(groupId);

            section.items.forEach((rawItem) => {
                const normalized = this._normalizeToolbarItem(rawItem);
                if (!normalized || !domItems.has(normalized.id) || seenItems.has(normalized.id)) return;
                items.push(normalized);
                seenItems.add(normalized.id);
            });
        });

        if (includeMissing) {
            const defaultItemIds = this._getDefaultToolbarItemIds();
            defaultItemIds.forEach((itemId) => {
                if (seenItems.has(itemId) || !domItems.has(itemId)) return;
                items.push({ id: itemId, visible: true });
                seenItems.add(itemId);
            });

            for (const itemId of domItems.keys()) {
                if (seenItems.has(itemId)) continue;
                items.push({ id: itemId, visible: true });
                seenItems.add(itemId);
            }
        }

        return [{ group: this._toolbarPrimaryGroupId, items }];
    },

    _readToolbarLayoutFromDom() {
        return [{
            group: this._toolbarPrimaryGroupId,
            items: this._getToolbarItems().map((item) => ({
                id: item.dataset.toolbarItem,
                visible: item.dataset.toolbarItem === 'toolbarSettings' || item.dataset.toolbarHidden !== 'true'
            }))
        }];
    },

    _readSavedToolbarLayout() {
        try {
            const saved = localStorage.getItem(this._toolbarStorageKey());
            if (!saved) return null;
            const parsed = JSON.parse(saved);
            return this._normalizeToolbarLayout(parsed);
        } catch (e) {
            return null;
        }
    },

    _saveLocalToolbarLayout(layout) {
        const normalized = this._normalizeToolbarLayout(layout);
        if (!normalized) return;
        localStorage.setItem(this._toolbarStorageKey(), JSON.stringify(normalized));
    },

    _clearLocalToolbarLayout() {
        localStorage.removeItem(this._toolbarStorageKey());
    },

    _ensureDefaultToolbarLayout() {
        if (!this._defaultToolbarLayout) {
            this._defaultToolbarLayout = this._readGroupedToolbarLayoutFromDom();
        }
    },

    _updateToolbarGroupVisibility() {
        const toolbar = this._getToolbarElement();
        if (toolbar) toolbar.dataset.toolbarFlat = 'true';

        this._getToolbarGroups().forEach((group) => {
            const visibleItems = Array.from(group.querySelectorAll('[data-toolbar-item]'))
                .filter((item) => item.dataset.toolbarHidden !== 'true');
            group.dataset.toolbarEmpty = visibleItems.length ? 'false' : 'true';
        });
    },

    applyToolbarLayout(layout = this._readSavedToolbarLayout()) {
        if (!Array.isArray(layout)) {
            this._updateToolbarGroupVisibility();
            return;
        }
        const normalizedLayout = this._normalizeToolbarLayout(layout);
        if (!normalizedLayout) return;
        const groups = new Map(this._getToolbarGroups().map((group) => [group.dataset.toolbarGroup, group]));
        const primaryGroup = groups.get(this._toolbarPrimaryGroupId) || this._getToolbarGroups()[0];
        if (!primaryGroup) return;
        const items = new Map(this._getToolbarItems().map((item) => [item.dataset.toolbarItem, item]));
        const placed = new Set();

        normalizedLayout.flatMap((section) => section.items || []).forEach((layoutItem) => {
            const normalized = this._normalizeToolbarItem(layoutItem);
            if (!normalized) return;
            const item = items.get(normalized.id);
            if (!item || placed.has(normalized.id)) return;
            item.dataset.toolbarHidden = normalized.visible ? 'false' : 'true';
            primaryGroup.appendChild(item);
            placed.add(normalized.id);
        });

        for (const [itemId, item] of items) {
            if (!placed.has(itemId)) {
                primaryGroup.appendChild(item);
                placed.add(itemId);
            }
        }

        for (const [itemId, item] of items) {
            if (itemId === 'toolbarSettings') {
                item.dataset.toolbarHidden = 'false';
            }
        }

        this._updateToolbarGroupVisibility();
        const toolbar = this._getToolbarElement();
        if (toolbar) toolbar.scrollLeft = 0;
    },

    async _persistToolbarLayout(layout) {
        const normalized = this._normalizeToolbarLayout(layout);
        const response = await fetch(this._toolbarLayoutEndpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layout: normalized })
        });
        if (!response.ok) {
            let message = '保存失败';
            try {
                const data = await response.json();
                message = data.error || message;
            } catch (e) {}
            throw new Error(message);
        }
        return response.json();
    },

    async initToolbarLayout() {
        this._ensureDefaultToolbarLayout();
        const localLayout = this._readSavedToolbarLayout();
        if (localLayout) this.applyToolbarLayout(localLayout);
        return this.loadToolbarLayout();
    },

    async loadToolbarLayout({ force = false } = {}) {
        this._ensureDefaultToolbarLayout();
        if (!force && this._serverToolbarLayoutLoaded) return;
        if (!force && this._toolbarLayoutRequest) return this._toolbarLayoutRequest;

        const localLayout = this._readSavedToolbarLayout();
        if (localLayout) this.applyToolbarLayout(localLayout);

        this._toolbarLayoutRequest = fetch(this._toolbarLayoutEndpoint, { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error('读取工具栏配置失败');
                const data = await response.json();
                const serverLayout = this._normalizeToolbarLayout(data.layout);
                this._serverToolbarLayoutLoaded = true;

                if (serverLayout) {
                    this._saveLocalToolbarLayout(serverLayout);
                    this.applyToolbarLayout(serverLayout);
                    return serverLayout;
                }

                this._clearLocalToolbarLayout();
                this.applyToolbarLayout(this._cloneToolbarLayout(this._defaultToolbarLayout));
                return null;
            })
            .catch(() => {
                if (localLayout) this.applyToolbarLayout(localLayout);
                return localLayout;
            })
            .finally(() => {
                this._toolbarLayoutRequest = null;
            });

        return this._toolbarLayoutRequest;
    },

    _renderToolbarSettings() {
        const list = document.getElementById('toolbar-settings-list');
        if (!list) return;
        const groupByItem = this._getToolbarDefaultGroupByItem();
        const itemsHtml = this._getToolbarItems().map((item) => {
            const itemId = item.dataset.toolbarItem;
            const label = item.dataset.toolbarLabel || item.title || item.textContent.trim() || itemId;
            const visible = itemId === 'toolbarSettings' || item.dataset.toolbarHidden !== 'true';
            const disabled = itemId === 'toolbarSettings' ? ' disabled' : '';
            const category = this._getToolbarGroupLabel(groupByItem.get(itemId));
            return `
                <div class="toolbar-settings-item${visible ? '' : ' toolbar-settings-item-muted'}" data-toolbar-settings-item="${itemId}">
                    <span class="toolbar-settings-item-label">${this._escapeHtml(label)}</span>
                    <span class="toolbar-settings-category">${this._escapeHtml(category)}</span>
                    <label class="toolbar-settings-visibility">
                        <input type="checkbox" onchange="tools.toggleToolbarSettingsItem('${itemId}', this.checked)"${visible ? ' checked' : ''}${disabled}>
                        <span>显示</span>
                    </label>
                    <div class="toolbar-settings-item-actions">
                        <button type="button" class="tool-btn" onclick="tools.shiftToolbarSettingsItem('${itemId}', -1)" title="上移">↑</button>
                        <button type="button" class="tool-btn" onclick="tools.shiftToolbarSettingsItem('${itemId}', 1)" title="下移">↓</button>
                    </div>
                </div>`;
        }).join('');

        list.innerHTML = `
            <section class="toolbar-settings-section toolbar-settings-section-flat">
                <h4>全部按钮</h4>
                <div class="toolbar-settings-items">${itemsHtml || '<div class="toolbar-settings-empty">空</div>'}</div>
            </section>`;
    },

    openToolbarSettings() {
        this.loadToolbarLayout().finally(() => {
            this._renderToolbarSettings();
            document.getElementById('toolbar-settings-modal')?.classList.add('show');
        });
    },

    closeToolbarSettings() {
        document.getElementById('toolbar-settings-modal')?.classList.remove('show');
    },

    toggleToolbarSettingsItem(itemId, visible) {
        const item = document.querySelector(`[data-toolbar-item="${this._cssEscape(itemId)}"]`);
        if (!item) return;
        item.dataset.toolbarHidden = itemId === 'toolbarSettings' || visible ? 'false' : 'true';
        const row = document.querySelector(`[data-toolbar-settings-item="${this._cssEscape(itemId)}"]`);
        if (row) row.classList.toggle('toolbar-settings-item-muted', item.dataset.toolbarHidden === 'true');
        this._updateToolbarGroupVisibility();
    },

    moveToolbarSettingsItem(itemId, groupId) {
        const item = document.querySelector(`[data-toolbar-item="${this._cssEscape(itemId)}"]`);
        const group = document.querySelector(`.quick-tools [data-toolbar-group="${this._cssEscape(groupId || this._toolbarPrimaryGroupId)}"]`);
        if (!item || !group) return;
        group.appendChild(item);
        this._renderToolbarSettings();
    },

    shiftToolbarSettingsItem(itemId, direction) {
        const item = document.querySelector(`[data-toolbar-item="${this._cssEscape(itemId)}"]`);
        if (!item) return;
        const siblings = Array.from(item.parentElement.querySelectorAll('[data-toolbar-item]'));
        const index = siblings.indexOf(item);
        const target = siblings[index + direction];
        if (!target) return;
        if (direction < 0) {
            item.parentElement.insertBefore(item, target);
        } else {
            item.parentElement.insertBefore(target, item);
        }
        this._renderToolbarSettings();
    },

    async saveToolbarLayout() {
        const layout = this._readToolbarLayoutFromDom();
        this._saveLocalToolbarLayout(layout);

        try {
            const data = await this._persistToolbarLayout(layout);
            const savedLayout = this._normalizeToolbarLayout(data.layout || layout);
            if (savedLayout) {
                this._saveLocalToolbarLayout(savedLayout);
                this.applyToolbarLayout(savedLayout);
            }
            this._serverToolbarLayoutLoaded = true;
            this.closeToolbarSettings();
            ui.showToast('工具栏配置已保存到账号');
        } catch (e) {
            ui.showToast(e.message || '保存到账号失败，已保存在本机', false);
        }
    },

    async resetToolbarLayout() {
        this._ensureDefaultToolbarLayout();
        const defaultLayout = this._cloneToolbarLayout(this._defaultToolbarLayout) || this._readToolbarLayoutFromDom();

        try {
            const response = await fetch(this._toolbarLayoutEndpoint, { method: 'DELETE' });
            if (!response.ok) throw new Error('恢复默认失败');
            this._clearLocalToolbarLayout();
            this._serverToolbarLayoutLoaded = true;
            this.applyToolbarLayout(defaultLayout);
            this._renderToolbarSettings();
            this.closeToolbarSettings();
            ui.showToast('工具栏已恢复默认');
        } catch (e) {
            ui.showToast(e.message || '恢复默认失败', false);
        }
    },

    _getEditorText() {
        return ui.editor?.getValue ? ui.editor.getValue() : '';
    },

    _indexFromPosition(pos, text = this._getEditorText()) {
        const lines = text.split('\n');
        let offset = 0;
        const targetLine = Math.max(0, Math.min(pos.line || 0, lines.length - 1));
        for (let i = 0; i < targetLine; i++) {
            offset += (lines[i] || '').length + 1;
        }
        return offset + Math.max(0, Math.min(pos.ch || 0, (lines[targetLine] || '').length));
    },

    _positionFromIndex(index, text = this._getEditorText()) {
        const safeIndex = Math.max(0, Math.min(index, text.length));
        const before = text.slice(0, safeIndex);
        const lines = before.split('\n');
        return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    },

    _getSelectionRange(text = this._getEditorText()) {
        const cm = ui.editor?._editor;
        if (cm?.getCursor && cm?.indexFromPos) {
            const from = cm.getCursor('from');
            const to = cm.getCursor('to');
            return {
                start: cm.indexFromPos(from),
                end: cm.indexFromPos(to),
                text: cm.getSelection ? cm.getSelection() : ''
            };
        }

        const selectedText = ui.editor?.getSelection ? ui.editor.getSelection() : '';
        const cursor = ui.editor?.getPosition ? ui.editor.getPosition() : { line: 0, ch: 0 };
        const cursorIndex = ui.editor?.getCursorPos
            ? ui.editor.getCursorPos()
            : this._indexFromPosition(cursor, text);
        return {
            start: Math.max(0, cursorIndex - selectedText.length),
            end: cursorIndex,
            text: selectedText
        };
    },

    _setSelectionByIndex(start, end = start) {
        if (!ui.editor?.setSelection) return;
        ui.editor.setSelection(start, end);
    },

    _replaceRange(start, end, replacement, cursorStart = start + replacement.length, cursorEnd = cursorStart) {
        const text = this._getEditorText();
        const safeStart = Math.max(0, Math.min(start, text.length));
        const safeEnd = Math.max(safeStart, Math.min(end, text.length));

        if (ui.editor?.executeEdits && ui.editor?.setSelection) {
            this._setSelectionByIndex(safeStart, safeEnd);
            ui.editor.executeEdits('toolbarEdit', [{ text: replacement }]);
        } else if (ui.editor?.setValue) {
            ui.editor.setValue(text.slice(0, safeStart) + replacement + text.slice(safeEnd));
        }

        this._setSelectionByIndex(cursorStart, cursorEnd);
        ui.editor?.focus?.();
        ui.save();
        ui.updatePreview();
    },

    _currentLineRange(includeLineBreak = false) {
        const text = this._getEditorText();
        const cursor = ui.editor?.getPosition ? ui.editor.getPosition() : { line: 0, ch: 0 };
        const lines = text.split('\n');
        const line = Math.max(0, Math.min(cursor.line || 0, lines.length - 1));
        const start = this._indexFromPosition({ line, ch: 0 }, text);
        let end = start + (lines[line] || '').length;
        if (includeLineBreak && line < lines.length - 1) end += 1;
        return { text, lines, line, start, end, lineText: lines[line] || '' };
    },

    _getLineEditContext(text = this._getEditorText()) {
        const range = this._getSelectionRange(text);
        const cursor = ui.editor?.getPosition
            ? ui.editor.getPosition()
            : this._positionFromIndex(range.end, text);
        const hasSelection = range.end > range.start;
        const selectionStart = hasSelection ? range.start : this._indexFromPosition(cursor, text);
        const selectionEnd = hasSelection ? range.end : selectionStart;
        const startLine = hasSelection
            ? this._positionFromIndex(selectionStart, text).line
            : Math.max(0, cursor.line || 0);
        const endLine = hasSelection
            ? this._positionFromIndex(Math.max(selectionStart, selectionEnd - 1), text).line
            : startLine;

        return {
            text,
            lines: text.split('\n'),
            hasSelection,
            selectionStart,
            selectionEnd,
            startLine,
            endLine
        };
    },

    _applyLineTransform(transformLine) {
        const context = this._getLineEditContext();
        let deltaStart = 0;
        let deltaEnd = 0;

        for (let line = context.startLine; line <= context.endLine; line++) {
            const original = context.lines[line] || '';
            const updated = transformLine(original, line, context);
            const delta = updated.length - original.length;
            if (line === context.startLine) deltaStart = delta;
            deltaEnd += delta;
            context.lines[line] = updated;
        }

        const newText = context.lines.join('\n');
        if (newText === context.text) return false;

        ui.editor.setValue(newText);
        const newStart = Math.max(0, context.selectionStart + (context.hasSelection ? deltaStart : Math.max(0, deltaStart)));
        const newEnd = Math.max(newStart, context.selectionEnd + deltaEnd);
        this._setSelectionByIndex(context.hasSelection ? newStart : newEnd, newEnd);
        ui.editor.focus();
        ui.save();
        ui.updatePreview();
        return true;
    },

    _escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    _copyTextWithExecCommand(text, restoreRange = null) {
        if (typeof document.execCommand !== 'function') return false;

        const textarea = document.createElement('textarea');
        const activeElement = document.activeElement;
        textarea.value = String(text ?? '');
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '-9999px';
        textarea.style.width = '1px';
        textarea.style.height = '1px';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        textarea.style.fontSize = '16px';

        document.body.appendChild(textarea);

        try {
            textarea.focus({ preventScroll: true });
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            return document.execCommand('copy');
        } catch (e) {
            return false;
        } finally {
            textarea.remove();
            if (restoreRange) {
                try {
                    this._setSelectionByIndex(restoreRange.start, restoreRange.end);
                } catch (e) {}
            }
            try {
                activeElement?.focus?.({ preventScroll: true });
            } catch (e) {}
        }
    },

    async _writeClipboardText(text, restoreRange = null) {
        const value = String(text ?? '');
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(value);
                return true;
            } catch (e) {}
        }
        return this._copyTextWithExecCommand(value, restoreRange);
    },

    async _readClipboardText() {
        if (!navigator.clipboard?.readText || !window.isSecureContext) return null;

        try {
            return await navigator.clipboard.readText();
        } catch (e) {
            return null;
        }
    },

    _readClipboardTextWithExecCommand() {
        if (typeof document.execCommand !== 'function') return null;

        const textarea = document.createElement('textarea');
        textarea.setAttribute('aria-hidden', 'true');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '-9999px';
        textarea.style.width = '1px';
        textarea.style.height = '1px';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        textarea.style.fontSize = '16px';

        document.body.appendChild(textarea);

        try {
            textarea.focus({ preventScroll: true });
            textarea.select();
            const success = document.execCommand('paste');
            return success ? textarea.value : null;
        } catch (e) {
            return null;
        } finally {
            textarea.remove();
        }
    },

    _insertEditorText(text, range = this._getSelectionRange()) {
        const value = String(text ?? '');
        const cursor = range.start + value.length;
        this._replaceRange(range.start, range.end, value, cursor, cursor);
    },

    _promptNativePaste(range = this._getSelectionRange()) {
        this._setSelectionByIndex(range.start, range.end);
        try {
            ui.editor?.focus?.();
        } catch (e) {}

        const isTouchDevice = window.matchMedia?.('(pointer: coarse)').matches
            || navigator.maxTouchPoints > 0;
        ui.showToast(isTouchDevice ? '请长按编辑区粘贴' : '请按 Ctrl/Cmd+V 粘贴', false);
    },

    // 编辑器操作 - 使用适配器接口
    async editorAction(type) {
        if (!ui.editor) return;

        if (type === 'copy') {
            const range = this._getSelectionRange();
            try {
                let text = range.text;
                if (!text) {
                    text = this._currentLineRange(false).lineText;
                }
                const copied = await this._writeClipboardText(text, range);
                if (!copied) throw new Error('copy failed');
                ui.showToast(text ? "已复制" : "已复制空行");
            } catch (e) {
                ui.showToast("复制失败", false);
            }
        }         else if (type === 'cut') {
            try {
                const range = this._getSelectionRange();
                const text = range.text;

                if (text) {
                    const copied = await this._writeClipboardText(text, range);
                    if (!copied) throw new Error('cut copy failed');
                    this._replaceRange(range.start, range.end, '', range.start, range.start);
                    ui.showToast("已剪切");
                } else {
                    ui.showToast("未选择内容", false);
                }
            } catch (e) {
                console.error('[剪切] 剪切操作失败:', e);
                ui.showToast("剪切失败", false);
            }
        } else if (type === 'paste') {
            try {
                const range = this._getSelectionRange();
                const text = await this._readClipboardText();
                if (text !== null) {
                    if (text) {
                        this._insertEditorText(text, range);
                        ui.showToast("已粘贴");
                    } else {
                        ui.showToast("剪贴板为空", false);
                    }
                    return;
                }

                const pastedText = this._readClipboardTextWithExecCommand();
                if (pastedText !== null) {
                    if (pastedText) {
                        this._insertEditorText(pastedText, range);
                        ui.showToast("已粘贴");
                    } else {
                        ui.showToast("剪贴板为空", false);
                    }
                    return;
                }

                this._promptNativePaste(range);
            } catch (e) {
                console.error('粘贴操作失败:', e);
                ui.showToast("粘贴失败", false);
            }
        } else if (type === 'selectAll') {
            if (ui.editor.select) {
                ui.editor.select();
            } else if (ui.editor.execCommand) {
                ui.editor.execCommand('selectAll');
            }
            ui.editor.focus();
        } else if (type === 'selectLine') {
            const text = this._getEditorText();
            const lines = text.split('\n');
            const cursor = ui.editor.getPosition ? ui.editor.getPosition() : { line: 0, ch: 0 };
            const line = Math.max(0, Math.min(cursor.line || 0, lines.length - 1));
            const start = this._indexFromPosition({ line, ch: 0 }, text);
            const end = line + 1 < lines.length
                ? this._indexFromPosition({ line: line + 1, ch: 0 }, text)
                : start + (lines[line] || '').length;
            this._setSelectionByIndex(start, end);
            if (ui.editor.scrollIntoView) {
                ui.editor.scrollIntoView({ line, ch: 0 }, 96);
            }
            ui.editor.focus();
        }
    },

    // 移动光标 - 使用适配器接口
    moveCursor(dir) {
        if (!ui.editor) return;
        const preferredColumnKey = '_z7notePreferredCursorColumn';
        const lastVerticalPositionKey = '_z7noteLastVerticalCursorPosition';

        // 获取当前光标位置
        const cursor = ui.editor.getPosition ? ui.editor.getPosition() : { line: 0, ch: 0 };
        const line = cursor.line || 0;
        const ch = cursor.ch || 0;
        const fullText = ui.editor.getValue ? ui.editor.getValue() : '';
        const lines = fullText.split('\n');
        const isVerticalMove = dir === 'up' || dir === 'down';
        if (!isVerticalMove) {
            ui.editor[preferredColumnKey] = null;
            ui.editor[lastVerticalPositionKey] = null;
        }
        const lastVerticalPosition = ui.editor[lastVerticalPositionKey];
        const isContinuingVerticalMove = isVerticalMove
            && lastVerticalPosition
            && lastVerticalPosition.line === line
            && lastVerticalPosition.ch === ch;
        const preferredColumn = isVerticalMove
            ? (isContinuingVerticalMove && Number.isFinite(ui.editor[preferredColumnKey])
                ? ui.editor[preferredColumnKey]
                : ch)
            : ch;

        // 获取当前行内容
        const lineLength = lines[line] ? lines[line].length : 0;

        let newPos = { line: line, ch: ch };

        if (dir === 'left') {
            if (ch > 0) {
                newPos.ch = ch - 1;
            } else if (line > 0) {
                // 移动到上一行末尾
                newPos.line = line - 1;
                newPos.ch = (lines[line - 1] || '').length;
            }
        } else if (dir === 'right') {
            if (ch < lineLength) {
                newPos.ch = ch + 1;
            } else {
                // 移动到下一行开头
                if (lines[line + 1] !== undefined) {
                    newPos.line = line + 1;
                    newPos.ch = 0;
                }
            }
        } else if (dir === 'up') {
            if (line > 0) {
                const targetLine = line - 1;
                newPos.line = targetLine;
                newPos.ch = Math.min(preferredColumn, (lines[targetLine] || '').length);
            }
        } else if (dir === 'down') {
            if (lines[line + 1] !== undefined) {
                const targetLine = line + 1;
                newPos.line = targetLine;
                newPos.ch = Math.min(preferredColumn, (lines[targetLine] || '').length);
            }
        }
        if (isVerticalMove) {
            ui.editor[preferredColumnKey] = preferredColumn;
            ui.editor[lastVerticalPositionKey] = { line: newPos.line, ch: newPos.ch };
        }

        // 设置新光标位置
        if (ui.editor.setPosition) {
            ui.editor.setPosition(newPos);
        } else if (ui.editor.setSelection) {
            // 使用 setSelection 设置光标（开始和结束位置相同）
            const fullText = ui.editor.getValue ? ui.editor.getValue() : '';
            let offset = 0;
            const lines = fullText.split('\n');
            for (let i = 0; i < newPos.line; i++) {
                offset += (lines[i] || '').length + 1;
            }
            offset += newPos.ch;
            ui.editor.setSelection(offset, offset);
        }

        ui.editor.focus();
        if (ui.editor.scrollIntoView) {
            ui.editor.scrollIntoView(newPos, 120);
        }
    },

    // 插入符号 - 使用适配器接口
    insertSymbol(before, after = "") {
        if (!ui.editor) return;

        const b = before.replace(/\\n/g, '\n');
        const a = after.replace(/\\n/g, '\n');
        const range = this._getSelectionRange();
        const insertText = b + range.text + a;
        const cursor = range.start + b.length + range.text.length;

        this._replaceRange(range.start, range.end, insertText, cursor, cursor);
    },

    wrapSelection(before, after = before, placeholder = '') {
        if (!ui.editor) return;
        const text = this._getEditorText();
        const range = this._getSelectionRange();
        if (
            range.text
            && text.slice(range.start - before.length, range.start) === before
            && text.slice(range.end, range.end + after.length) === after
        ) {
            const replacement = range.text;
            this._replaceRange(
                range.start - before.length,
                range.end + after.length,
                replacement,
                range.start - before.length,
                range.end - before.length
            );
            return;
        }

        const inner = range.text || placeholder;
        const replacement = before + inner + after;
        const innerStart = range.start + before.length;
        const innerEnd = innerStart + inner.length;

        this._replaceRange(range.start, range.end, replacement, innerStart, innerEnd);
    },

    insertTemplate(type) {
        const templates = {
            table: '| 项目 | 内容 |\n| --- | --- |\n|  |  |',
            image: '![图片说明](图片地址)'
        };
        const template = templates[type];
        if (!template) return;
        this.insertSymbol(template);
    },

    toggleLinePrefix(prefix, options = {}) {
        if (!ui.editor) return;
        const escapedPrefix = this._escapeRegExp(prefix);
        const prefixPattern = options.pattern || new RegExp(`^(\\s*)${escapedPrefix}\\s?`);
        this._applyLineTransform((line) => {
            if (prefixPattern.test(line)) {
                return line.replace(prefixPattern, '$1');
            }
            return line.replace(/^(\s*)/, `$1${prefix}`);
        });
    },

    toggleHeading() {
        if (!ui.editor) return;
        this._applyLineTransform((line) => {
            if (/^\s*#{1,6}\s+/.test(line)) {
                return line.replace(/^(\s*)#{1,6}\s+/, '$1');
            }
            return line.replace(/^(\s*)/, '$1# ');
        });
    },

    toggleTodo() {
        if (!ui.editor) return;
        this._applyLineTransform((line) => {
            if (/^(\s*)-\s+\[[ xX]\]\s+/.test(line)) {
                return line.replace(/^(\s*)-\s+\[[ xX]\]\s+/, '$1');
            }
            return line.replace(/^(\s*)/, '$1- [ ] ');
        });
    },

    indentSelection(direction = 'in') {
        if (!ui.editor) return;
        this._applyLineTransform((line) => {
            if (direction === 'out') {
                return line.startsWith('    ')
                    ? line.slice(4)
                    : line.replace(/^\s{1,3}/, '');
            }
            return `    ${line}`;
        });
    },

    duplicateCurrentLine() {
        if (!ui.editor) return;

        const context = this._getLineEditContext();
        const { lines, startLine, endLine } = context;
        const block = lines.slice(startLine, endLine + 1);
        const nextStartLine = endLine + 1;
        lines.splice(nextStartLine, 0, ...block);

        const nextEndLine = nextStartLine + block.length - 1;
        const newText = lines.join('\n');
        ui.editor.setValue(newText);
        const selectionStart = this._indexFromPosition({ line: nextStartLine, ch: 0 }, newText);
        const selectionEnd = this._indexFromPosition(
            { line: nextEndLine, ch: (lines[nextEndLine] || '').length },
            newText
        );
        this._setSelectionByIndex(selectionStart, selectionEnd);
        if (ui.editor.scrollIntoView) {
            ui.editor.scrollIntoView({ line: nextStartLine, ch: 0 }, 96);
        }
        ui.editor.focus();
        ui.save();
        ui.updatePreview();
        ui.showToast(block.length > 1 ? `已复制 ${block.length} 行` : '已复制当前行');
    },

    deleteCurrentLine() {
        if (!ui.editor) return;

        const context = this._getLineEditContext();
        const { lines, startLine, endLine } = context;
        const block = lines.slice(startLine, endLine + 1);
        const removedCount = block.length;
        if (removedCount >= lines.length) {
            lines.splice(0, lines.length, '');
        } else {
            lines.splice(startLine, removedCount);
        }

        const newText = lines.join('\n');
        const cursorLine = Math.max(0, Math.min(startLine, lines.length - 1));
        const cursorIndex = this._indexFromPosition({ line: cursorLine, ch: 0 }, newText);
        ui.editor.setValue(newText);
        this._setSelectionByIndex(cursorIndex, cursorIndex);
        if (ui.editor.scrollIntoView) {
            ui.editor.scrollIntoView({ line: cursorLine, ch: 0 }, 96);
        }
        ui.editor.focus();
        ui.save();
        ui.updatePreview();
        const hasContent = block.some((line) => line.trim());
        ui.showToast(removedCount > 1 ? `已删除 ${removedCount} 行` : (hasContent ? '已删除当前行' : '已删除空行'));
    },

    moveLines(direction = 'up') {
        if (!ui.editor) return;

        const context = this._getLineEditContext();
        const { lines, startLine, endLine } = context;
        const moveDown = direction === 'down';
        if (lines.length <= 1) {
            ui.showToast('没有可移动的行', false);
            return;
        }
        if (!moveDown && startLine <= 0) {
            ui.showToast('已经在顶部', false);
            return;
        }
        if (moveDown && endLine >= lines.length - 1) {
            ui.showToast('已经在底部', false);
            return;
        }

        const block = lines.slice(startLine, endLine + 1);
        let nextStartLine;
        if (moveDown) {
            const nextLine = lines[endLine + 1];
            lines.splice(startLine, block.length + 1, nextLine, ...block);
            nextStartLine = startLine + 1;
        } else {
            const previousLine = lines[startLine - 1];
            lines.splice(startLine - 1, block.length + 1, ...block, previousLine);
            nextStartLine = startLine - 1;
        }

        const nextEndLine = nextStartLine + block.length - 1;
        const newText = lines.join('\n');
        ui.editor.setValue(newText);
        const selectionStart = this._indexFromPosition({ line: nextStartLine, ch: 0 }, newText);
        const selectionEnd = this._indexFromPosition(
            { line: nextEndLine, ch: (lines[nextEndLine] || '').length },
            newText
        );
        this._setSelectionByIndex(selectionStart, selectionEnd);
        if (ui.editor.scrollIntoView) {
            ui.editor.scrollIntoView({ line: nextStartLine, ch: 0 }, 96);
        }
        ui.editor.focus();
        ui.save();
        ui.updatePreview();
        ui.showToast(moveDown ? '已下移行' : '已上移行');
    },

    // 插入待办事项 - 使用适配器接口
    insertTodo(completed = false) {
        if (!ui.editor) return;

        const checkbox = completed ? '- [x] ' : '- [ ] ';
        const range = this._getSelectionRange();
        const insertText = checkbox + range.text;
        const cursor = range.start + insertText.length;
        this._replaceRange(range.start, range.end, insertText, cursor, cursor);
    },

    // 导出当前笔记为 TXT
    exportCurrentAsTxt() {
        if (!ui.editor || !ui.activeId) return ui.showToast("没有选中的笔记", false);

        let content;
        if (ui.editor.getValue) {
            content = ui.editor.getValue();
        }

        const note = ui.notes.find(n => n.id.toString() === ui.activeId.toString());
        const fileName = (note?.title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '-') + '.txt';
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
        ui.showToast("已导出 TXT");
    },

    // 查找下一个 - 使用适配器接口
    findNext() {
        if (!ui.editor) return;
        const findText = document.getElementById('find-input').value;
        if (!findText) return;

        const content = ui.editor.getValue();

        const lowerContent = content.toLowerCase();
        const lowerFindText = findText.toLowerCase();

        // 使用 selectionStart/selectionEnd 或 getCursorPos
        let currentOffset;
        if (ui.editor.selectionEnd !== undefined) {
            currentOffset = ui.editor.selectionEnd;
        } else {
            const pos = ui.editor.getPosition();
            currentOffset = ui.editor.getModel().getOffsetAt(pos);
        }

        // 从当前位置开始查找
        let nextIdx = lowerContent.indexOf(lowerFindText, currentOffset);

        if (nextIdx === -1) {
            // 从头开始查找
            nextIdx = lowerContent.indexOf(lowerFindText, 0);
        }

        if (nextIdx > -1) {
            ui.editor.setSelection(nextIdx, nextIdx + findText.length);
            ui.editor.focus();
        } else {
            ui.showToast("未找到匹配内容", false);
        }
    },

    // 整篇替换 - 使用适配器接口
    replaceAll() {
        if (!ui.editor) return;
        const findText = document.getElementById('find-input').value;
        const replaceText = document.getElementById('replace-input').value;

        if (!findText) {
            ui.showToast("请输入查找内容", false);
            return;
        }

        const content = ui.editor.getValue();
        const newContent = content.split(findText).join(replaceText);

        if (content === newContent) {
            ui.showToast("无需替换", false);
        } else {
            ui.editor.setValue(newContent);
            ui.save();
            ui.updatePreview();
            ui.showToast("整篇替换完成");
        }
    },

    // 全站替换 - 替换所有笔记中的内容
    async replaceAllNotes() {
        const findText = document.getElementById('find-input').value;
        const replaceText = document.getElementById('replace-input').value;

        if (!findText) {
            ui.showToast("请输入查找内容", false);
            return;
        }

        if (!confirm(`确定要在所有笔记中，将 "${findText}" 替换为 "${replaceText}" 吗？此操作不可撤销。`)) {
            return;
        }

        let replaceCount = 0;
        const now = Math.floor(Date.now() / 1000);

        // 遍历所有笔记
        ui.notes = ui.notes.map(note => {
            if (note.content && note.content.includes(findText)) {
                const newContent = note.content.split(findText).join(replaceText);
                if (newContent !== note.content) {
                    replaceCount++;

                    // 根据第一行重新解析标题和分类
                    const lines = newContent.split('\n').filter(l => l.trim());
                    let newTitle = note.title;
                    if (lines.length > 0) {
                        const firstLine = lines[0].trim();
                        // 移除 Markdown 标记符号
                        let cleanLine = firstLine.replace(/^#+\s*/, '').trim();
                        cleanLine = cleanLine.replace(/^[`*_\-]+/, '').trim();

                        // 检查是否包含下划线（分类分隔符）
                        if (cleanLine.includes('_')) {
                            const parts = cleanLine.split('_');
                            const category = parts[0].replace(/^#+\s*/, '').trim();
                            const title = parts.slice(1).join('_').trim() || '未命名';
                            newTitle = `${category}_${title.substring(0, 80)}`;
                        } else {
                            newTitle = cleanLine.substring(0, 80) || '未命名';
                        }
                    }

                    return {
                        ...note,
                        title: newTitle,
                        content: newContent,
                        updatedAt: now,
                        isUnsynced: true
                    };
                }
            }
            return note;
        });

        // 保存到云端
        for (const note of ui.notes) {
            if (note.isUnsynced) {
                await ui.saveToCloud(note);
            }
        }

        // 如果当前笔记被修改，更新编辑器
        if (ui.activeId) {
            const updatedNote = ui.notes.find(n => n.id.toString() === ui.activeId.toString());
            if (updatedNote && ui.editor) {
                ui.editor.setValue(updatedNote.content || '');
                ui.updatePreview();
            }
        }

        // 重新渲染列表
        ui.render();

        if (replaceCount > 0) {
            ui.showToast(`全站替换完成，共修改 ${replaceCount} 篇笔记`);
        } else {
            ui.showToast("未找到匹配的内容", false);
        }
    },

    // 切换查找替换栏
    toggleSearchReplace() {
        const bar = document.getElementById('search-replace-bar');
        const isHidden = getComputedStyle(bar).display === 'none';
        bar.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) document.getElementById('find-input').focus();
    },

    // 导出数据
    async exportData() {
        const data = ui.notes || [];
        const json = JSON.stringify(data.filter(n => !n.deleted), null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `z7Note_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
    },

    // 清理格式
    cleanFormat() {
        if (!ui.editor) return;

        const content = ui.editor.getValue ? ui.editor.getValue() : '';
        if (!content) return;

        // 执行清理逻辑
        let cleaned = content
            .replace(/[ \t]+$/gm, '')           // 1. 去除每行行末空格
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // 2. 移除零宽空格等不可见字符
            .replace(/\n{3,}/g, '\n\n')         // 3. 将连续 3 个及以上换行压缩为 2 个
            .trim();                            // 4. 去除首尾空白

        // 如果内容有变化，则更新
        if (content !== cleaned) {
            const cursor = ui.editor.getCursor ? ui.editor.getCursor() : null;
            ui.editor.setValue(cleaned);
            if (cursor) ui.editor.setCursor(cursor);

            ui.save();
            ui.updatePreview();
            ui.showToast("格式已清理：去除了冗余空格与空行");
        } else {
            ui.showToast("内容已是规范格式，无需清理", false);
        }
    },

    // 导入数据
    importData(e) {
        const file = e.target.files[0];
        if (!file) return;

        ui.showToast("正在导入...", true);

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const imported = JSON.parse(ev.target.result);
                const items = Array.isArray(imported) ? imported : (imported.notes ? imported.notes : [imported]);

                if (items.length === 0) {
                    ui.showToast("文件中没有可导入的数据", false);
                    return;
                }

                let newNotes = [...ui.notes];
                let importCount = 0;
                let duplicateCount = 0;

                // 检查重复的辅助函数
                const isDuplicate = (item) => {
                    return ui.notes.some(existingNote => {
                        // 如果有相同的ID，认为是重复
                        if (item.id && existingNote.id === item.id) return true;
                        // 如果标题和内容都相同，认为是重复
                        if (item.title === existingNote.title && item.content === existingNote.content) return true;
                        return false;
                    });
                };

                items.forEach(item => {
                    if (!item.content) return;

                    // 检查是否重复
                    if (isDuplicate(item)) {
                        duplicateCount++;
                        return;
                    }

                    newNotes.unshift({
                        ...item,
                        id: Date.now().toString() + Math.random(),
                        isUnsynced: true,
                        deleted: false
                    });
                    importCount++;
                });

                if (importCount === 0 && duplicateCount > 0) {
                    ui.showToast(`所有笔记已存在，跳过 ${duplicateCount} 条重复`, false);
                    return;
                }

                if (importCount === 0) {
                    ui.showToast("没有有效的笔记内容", false);
                    return;
                }

                ui.notes = newNotes;

                // 保存到云端
                let savedCount = 0;
                for (const note of newNotes) {
                    if (note.isUnsynced) {
                        try {
                            await ui.saveToCloud(note);
                            savedCount++;
                        } catch (err) {
                            console.error('保存笔记失败:', err);
                        }
                    }
                }

                ui.render();

                // 显示导入结果
                let message = `导入成功：${importCount} 条笔记，已保存 ${savedCount} 条`;
                if (duplicateCount > 0) {
                    message += `，跳过 ${duplicateCount} 条重复`;
                }
                ui.showToast(message);
            } catch (err) {
                console.error('导入失败:', err);
                ui.showToast("导入失败：文件格式错误", false);
            }
        };
        reader.onerror = () => {
            ui.showToast("文件读取失败", false);
        };
        reader.readAsText(file);

        // 清空文件输入，允许重复导入同一文件
        e.target.value = '';
    }
};

// 导出
window.tools = ToolsManager;

registerBackupTools();
