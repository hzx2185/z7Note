// UI 核心逻辑模块
import { fetchWithTimeout } from './utils.js';
import { enhanceUIAccount } from './ui-account.js';
import { enhanceUIAccountPanel } from './ui-account-panel.js';
import { enhanceUIList } from './ui-list.js?v=1.0.18';
import { enhanceUIMarker } from './ui-marker.js';
import { enhanceUIPreview } from './ui-preview.js';
import { enhanceUIPreviewRenderer } from './ui-preview-renderer.js?v=1.0.15';
import { enhanceUISave } from './ui-save.js?v=1.0.9';
import { enhanceUIHistory } from './ui-history.js?v=1.0.17';

const UIManager = {
    notes: [],
    activeId: null,
    editor: null,
    editorType: null,
    timer: null,
    syncTimer: null,
    debounceTimer: null,
    isScrolling: false,
    batchMode: false,
    selectedIds: new Set(),
    collapsedFolders: new Set(),
    showCategories: false,
    isTogglingEditor: false,
    pendingEditorToggle: null,
    currentLimit: 50, // 新增：保存当前的限制条目数
    _isInitializingEditor: false,
    _pendingEditorInit: null,
    _currentEditorInitNoteId: null,
    _lastRenderedNotesHash: '', // 用于检测笔记是否真正变化
    _isComposing: false, // 输入法状态锁
    _isSaving: false, // 防止重复保存
    _isCreatingNote: false,
    _markedLoadingPromise: null, // 渲染引擎加载状态
    _editorInitRequestId: 0,

    // 标记功能相关属性
    markerStart: null,    // 标记起始位置
    markerEnd: null,      // 标记结束位置
    markerActive: false,  // 标记是否激活
    markerTimeouts: {},   // 存储标记定时器引用

    // 附件预览配置
    attachmentPreviewConfig: {
        pdfMaxSize: 10, // MB
        videoMaxSize: 50, // MB
        audioMaxSize: 20, // MB
        lazyLoad: true,
        autoLoad: false,
    },

    upsertNote(note, { toTop = false } = {}) {
        if (!note || note.id === undefined || note.id === null) return null;

        const noteId = note.id.toString();
        const index = this.notes.findIndex(n => n.id?.toString() === noteId);

        if (index !== -1) {
            this.notes[index] = { ...this.notes[index], ...note };
            return this.notes[index];
        }

        if (toTop) {
            this.notes.unshift(note);
        } else {
            this.notes.push(note);
        }
        return note;
    },

    // 初始化
    async init(db) {
        this.db = db;
        await this.loadTheme();
        this.initStatusLights();
    },

    // 初始化状态指示灯
    initStatusLights() {
        this.updateStatus('idle', '就绪');
    },

    // 更新状态
    updateStatus(state, text) {
        const dot = document.getElementById('status-dot');
        const label = document.getElementById('status-text');
        if (!dot || !label) return;

        dot.className = 'status-dot';
        switch (state) {
            case 'working':
                dot.classList.add('working');
                break;
            case 'success':
                dot.classList.add('success');
                break;
            case 'error':
                dot.classList.add('error');
                break;
            case 'warning':
                dot.classList.add('warning');
                break;
            default:
                // 默认灰色
        }
        label.textContent = text || '就绪';
    },

    // 加载主题
    loadTheme() {
        if (window.themeRuntime?.applySavedTheme) {
            window.themeRuntime.applySavedTheme();
            return;
        }

        const savedTheme = localStorage.getItem('p-theme');
        document.documentElement.classList.toggle('dark-mode', savedTheme === 'dark');
        document.documentElement.classList.toggle('light-mode', savedTheme !== 'dark');
    },

    // 切换主题
    async toggleTheme() {
        let isDark;
        if (window.themeRuntime?.toggleTheme) {
            const nextTheme = window.themeRuntime.toggleTheme();
            isDark = (window.themeRuntime.getAppliedTheme?.() || nextTheme) === 'midnight';
        } else {
            isDark = document.documentElement.classList.toggle('dark-mode');
            document.documentElement.classList.toggle('light-mode', !isDark);
            localStorage.setItem('p-theme', isDark ? 'dark' : 'light');
        }

        const hlLink = document.getElementById('hljs-style');
        if (hlLink) hlLink.href = isDark ? '/cdn/highlight-dark.min.css' : '/cdn/highlight-light.min.css';

        this.updatePreview();
    },

    // 显示提示 - 统一使用 updateStatus 显示在状态文字位置
    _statusRestoreTimer: null,
    showToast(msg, success = true) {
        // 清除之前的恢复定时器
        if (this._statusRestoreTimer) {
            clearTimeout(this._statusRestoreTimer);
        }

        // 所有提示都使用 updateStatus 显示在状态文字位置
        let state = 'idle';
        if (success === true) {
            state = 'success';
        } else if (success === false) {
            state = 'error';
        } else {
            // 对于其他值（如 undefined 或其他），默认为成功状态
            state = 'success';
        }

        this.updateStatus(state, msg);

        // 3秒后恢复为"就绪"
        this._statusRestoreTimer = setTimeout(() => {
            this.updateStatus('idle', '就绪');
        }, 3000);
    },

    // 切换侧边栏
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('overlay');
        const container = document.querySelector('.container');
        if (window.innerWidth <= 768) {
            const isShow = sidebar.classList.toggle('show');
            overlay.classList.toggle('show', isShow);
        } else {
            sidebar.classList.toggle('collapsed');
            container.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
        }
    },

    // 设置视图模式
    setMode(m) {
        document.getElementById('main-view').className = m;
        // 切换到分屏或预览模式时，强制更新预览
        if (m === 'split' || m === 'preview-only') {
            this.updatePreview(true); // force = true
        }
    },

    // 切换分屏模式
    toggleSplit() {
        const mainView = document.getElementById('main-view');
        if (mainView.className === 'split') {
            mainView.className = 'edit-only';
        } else {
            mainView.className = 'split';
            // 切换到分屏模式时，强制更新预览
            this.updatePreview(true);
        }
    },

    // 切换预览模式 (分屏用)
    togglePreview() {
        const mainView = document.getElementById('main-view');
        if (mainView.className === 'preview-only') {
            mainView.className = 'edit-only';
        } else {
            mainView.className = 'preview-only';
            this.updatePreview(true);
        }
    },


    // 显示/隐藏行号
    toggleEditor() {
        const container = document.getElementById("editor-container");
        if (!container) return;

        const storedLineNumbers = localStorage.getItem('show-line-numbers');
        const currentlyEnabled = storedLineNumbers === null
            ? true
            : storedLineNumbers !== 'false';
        const newState = !currentlyEnabled;

        if (newState) {
            container.classList.add('show-line-numbers');
        } else {
            container.classList.remove('show-line-numbers');
        }
        localStorage.setItem('show-line-numbers', newState ? 'true' : 'false');

        // 使用编辑器适配器的方法切换行号
        if (this.editor && typeof this.editor.toggleLineNumbers === 'function') {
            this.editor.toggleLineNumbers(newState);
        } else {
            // 编辑器未就绪，等待一下再重试
            setTimeout(() => {
                if (this.editor && typeof this.editor.toggleLineNumbers === 'function') {
                    this.editor.toggleLineNumbers(newState);
                }
            }, 50);
        }
    },

    // 切换自动换行
    toggleLineWrapping() {
        if (!this.editor) return;

        const currentlyEnabled = localStorage.getItem('line-wrapping') !== 'false';
        const newState = !currentlyEnabled;

        if (this.editor && typeof this.editor.toggleLineWrapping === 'function') {
            this.editor.toggleLineWrapping(newState);
        } else {
            // 编辑器未就绪，等待一下再重试
            setTimeout(() => {
                if (this.editor && typeof this.editor.toggleLineWrapping === 'function') {
                    this.editor.toggleLineWrapping(newState);
                }
            }, 50);
        }
    },

    // 初始化编辑器
    async initEditor(content, noteId = this.activeId) {
        // 如果正在使用输入法，不重新初始化
        if (this._isComposing && this.activeId) {
            return;
        }

        // 防抖：如果正在初始化，记录待处理的内容
        if (this._isInitializingEditor) {
            this._pendingEditorInit = { content, noteId };
            if (noteId?.toString() !== this._currentEditorInitNoteId?.toString()) {
                this._editorInitRequestId++;
            }
            return;
        }

        const requestId = ++this._editorInitRequestId;
        this._isInitializingEditor = true;
        this._isInitializing = true;
        this._pendingEditorInit = null;
        this._currentEditorInitNoteId = noteId;

        try {
            const container = document.getElementById("editor-container");
            if (!container) {
                return;
            }
            container.classList.remove('editor-load-error');

            if (window.EditorAdapterManager && typeof window.EditorAdapterManager.destroyCurrentEditor === 'function') {
                window.EditorAdapterManager.destroyCurrentEditor();
            } else if (this.editor && typeof this.editor.destroy === 'function') {
                try {
                    this.editor.destroy();
                } catch (e) {
                    console.error('旧编辑器销毁失败:', e);
                }
            }
            this.editor = null;

            // 使用适配器系统创建编辑器
            const editor = await window.EditorAdapterManager.createEditor(container, content, {
                onScroll: () => this.syncScroll(container, 'editor')
            });
            if (requestId !== this._editorInitRequestId) {
                if (editor && typeof editor.destroy === 'function') {
                    editor.destroy();
                }
                return;
            }
            this.editor = editor;

            if (this.editor) {
                const activeNote = this.activeId
                    ? this.notes.find(x => x.id.toString() === this.activeId.toString())
                    : null;
                if (activeNote && this.editor.getValue) {
                    this._lastSavedSignature = this._buildNoteSignature(activeNote, this.editor.getValue());
                }

                // 恢复标准滚动监听
                const wrapper = this.editor.getWrapperElement();
                if (wrapper) {
                    const passiveEvents = ['touchstart', 'touchmove', 'mousewheel', 'wheel'];
                    passiveEvents.forEach(eventName => {
                        wrapper.addEventListener(eventName, () => {}, { passive: true });
                    });
                }
            }

            // 根据编辑器类型显示/隐藏按钮
            this.updateToolbarButtons();
            this.updatePreview();

            // 强制触发数字高亮（延迟确保DOM完全渲染）
            setTimeout(() => {
                if (this.editor && this.editor.hasNumberHighlight) {
                    // 手动触发change事件
                    const event = new Event('change');
                    this.editor.trigger('change', event);
                }
            }, 1000);

            // 添加键盘快捷键监听
            this.setupMarkerShortcuts();

            // 添加点击监听器,只在标记完成后点击其他区域时清除标记
            const editorElement = this.editor.getWrapperElement();
            if (editorElement) {
                editorElement.addEventListener('click', (e) => {
                    // 只有在标记已经完成（起和终都有）的情况下，点击其他区域才清除标记
                    // 如果正在标记过程中（只有起没有终，或只有终没有起），允许用户继续操作
                    if (this.markerStart && this.markerEnd) {
                        // 检查是否点击了标记相关的元素
                        const isMarkerClick = e.target.closest('.marker-start, .marker-end, .marker-highlight, .marker-btn');
                        if (!isMarkerClick) {
                            this.clearMarker();
                        }
                    }
                });
            }
        } catch (e) {
            console.error('[Editor] 初始化失败:', e);
            this.editor = null;
            const container = document.getElementById("editor-container");
            if (container) {
                container.classList.add('editor-load-error');
                container.textContent = '编辑器加载失败，请稍后重试或刷新页面';
            }
            this.updateStatus('error', '编辑器加载失败');
        } finally {
            // 初始化完成，检查是否有待处理的内容
            this._isInitializingEditor = false;
            this._isInitializing = false;
            this._currentEditorInitNoteId = null;
            const pending = this._pendingEditorInit;
            this._pendingEditorInit = null;
            if (pending && (
                pending.content !== content ||
                pending.noteId?.toString() !== noteId?.toString()
            )) {
                setTimeout(() => this.initEditor(pending.content, pending.noteId), 100);
            }
        }
    },

    // 更新工具栏按钮显示状态
    updateToolbarButtons() {
        // CodeMirror 专用按钮（显示行号）始终显示
        const editorTypeBtn = document.getElementById('btn-editor-type');

        if (editorTypeBtn) editorTypeBtn.style.display = 'flex';
    },

    // 检测无效附件
    async checkInvalidAttachments(html) {
        const attachmentRegex = /(src|href)=["']\/api\/attachments\/raw\/([^"']+)["']/ig;
        const attachments = [];
        let match;

        while ((match = attachmentRegex.exec(html)) !== null) {
            attachments.push({
                type: match[1],
                path: match[2]
            });
        }

        if (attachments.length === 0) return;

        const invalidAttachments = [];
        const checkPromises = attachments.map(async (attachment) => {
            try {
                const response = await fetch(`/api/attachments/raw/${encodeURIComponent(attachment.path)}`, {
                    method: 'HEAD',
                    cache: 'no-cache'
                });

                if (!response.ok) {
                    invalidAttachments.push(attachment);
                }
            } catch (error) {
                invalidAttachments.push(attachment);
            }
        });

        await Promise.all(checkPromises);

        if (invalidAttachments.length > 0) {
            const message = `检测到 ${invalidAttachments.length} 个无效附件：\n${invalidAttachments.map(a => `• ${a.path}`).join('\n')}`;
            // 可以选择显示 Toast 提示
            // this.showToast(message, false);
        }
    },

    // 计算笔记列表的哈希值，用于检测是否需要重新渲染
    _calculateNotesHash(notes) {
        // 只计算关键字段的哈希：id, title, updatedAt, deleted
        const keyNotes = notes
            .filter(n => !n.deleted)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .map(n => `${n.id}:${n.title}:${n.updatedAt}:${n.deleted}`)
            .join('|');
        return keyNotes;
    },

    // 切换笔记 (shouldScroll 参数控制是否滚动列表)
    switch(id, shouldScroll = true) {
        const newId = id.toString();

        // 如果是同一个笔记，不重复初始化
        if (this.activeId === newId) {
            // 依然更新激活状态（以防列表刚重绘完）
            this.updateActiveStatus(shouldScroll);
            if (!this.editor && !this._isInitializingEditor) {
                const currentNote = this.notes.find(x => x.id.toString() === newId);
                if (currentNote) {
                    void this.initEditor(currentNote.content || '', currentNote.id);
                }
            }
            return;
        }

        // 如果正在输入，先提醒用户
        if (this._isComposing) {
            return;
        }

        if (this.activeId && this.editor && this._hasPendingSave()) {
            void this.flushPendingSave({ noteSnapshot: this._captureActiveNoteSnapshot() });
        }

        this.activeId = newId;

        // 切换笔记时清除标记
        this.clearMarker();

        const n = this.notes.find(x => x.id.toString() === this.activeId);

        if (n) {
            if (this.showCategories) {
                // 分类视图中切换到某篇笔记时，展开它所在的分类，保证当前项可见。
                let folder = '未分类';
                if (n.title && n.title.includes('_')) {
                    folder = n.title.split('_')[0].replace(/^#*\s*/, '').trim() || '未分类';
                }
                if (this.collapsedFolders.has(folder)) {
                    this.collapsedFolders.delete(folder);
                    this.render(undefined, true);
                }
            }

            // 更新标题输入框 - 恢复全标题模式
            const titleInput = document.getElementById('note-title-input');
            if (titleInput) titleInput.value = n.title || '';

            this._lastSavedSignature = this._buildNoteSignature(n, n.content || '');
            this.updateNoteMeta(n);

            void this.initEditor(n.content || '', n.id);

            // 额外触发刷新，解决沉浸式模式下行号宽度计算延迟的问题
            setTimeout(() => {
                if (this.editor && typeof this.editor.refresh === 'function') {
                    this.editor.refresh();
                }
            }, 100);

            // 优化：仅更新列表中的激活状态
            this.updateActiveStatus(shouldScroll);
        }
    },

    // 处理标题输入
    handleTitleInput(val) {
        if (!this.activeId) return;
        const n = this.notes.find(x => x.id.toString() === this.activeId);
        if (!n || n.title === val) return;

        const oldFullTitle = n.title;
        n.title = val;
        n.updatedAt = Math.floor(Date.now() / 1000);
        this.updateNoteMeta(n);

        // 实时更新侧边栏对应项的标题显示
        const noteEl = document.querySelector(`.note-item[data-id="${this.activeId}"] .note-info`);
        if (noteEl) {
            let displayTitle = val;
            if (displayTitle.includes('_')) {
                displayTitle = displayTitle.split('_').slice(1).join('_').trim();
            }
            noteEl.textContent = displayTitle || '无标题';
        }

        // 如果分类发生了变化，需要触发全量重新渲染
        const oldFolder = (oldFullTitle.includes('_') ? oldFullTitle.split('_')[0] : '未分类').trim();
        const newFolder = (val.includes('_') ? val.split('_')[0] : '未分类').trim();

        if (oldFolder !== newFolder) {
            this.render(undefined, true);
        }

        // 防抖保存
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.save(), this._getSaveDebounceDelay());
    },

    // 更新列表中笔记的激活状态
    updateActiveStatus(shouldScroll = false) {
        const list = document.getElementById('list');
        if (!list) return;

        // 移除所有旧的 active 类
        list.querySelectorAll('.note-item.active').forEach(el => {
            el.classList.remove('active');
        });

        // 给当前 activeId 对应的元素添加 active 类
        const activeEl = list.querySelector(`.note-item[data-id="${this.activeId}"]`);
        if (activeEl) {
            activeEl.classList.add('active');
            // 确保激活项在视口内 (仅在需要时滚动)
            if (shouldScroll) {
                activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    },

    // 创建笔记 - 云端优先
    async create() {
        if (this._isCreatingNote) return;
        this._isCreatingNote = true;
        try {
            const res = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: '新笔记',
                    content: ''
                })
            });

            if (res.ok) {
                const note = await res.json();
                this.upsertNote(note, { toTop: true });
                this.render(undefined, true);
                this.switch(note.id);
            } else {
                this.showToast('创建失败，请检查网络连接');
            }
        } catch (e) {
            this.showToast('创建失败，请检查网络连接');
        } finally {
            this._isCreatingNote = false;
        }
    },

    // 删除笔记 - 云端优先
    async del(id) {
        const nid = id.toString();
        const note = this.notes.find(x => x.id.toString() === nid);
        const title = note?.title || '这篇笔记';
        if (!confirm(`确定删除「${title}」？`)) return;

        // 保存当前 activeId，用于判断是否需要切换笔记
        const activeIdAtStart = this.activeId;

        // 直接调用API删除
        try {
            const res = await fetch(`/api/notes/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                // 从服务器重新加载笔记列表
                setTimeout(async () => {
                    try {
                        const refreshRes = await fetch('/api/files');
                        if (refreshRes.ok) {
                            const notes = await refreshRes.json();
                            this.notes = notes || [];

                            // 判断是否需要切换到其他笔记
                            if (activeIdAtStart?.toString() === nid) {
                                // 找到要切换到的最新笔记
                                const validNotes = this.notes.filter(n => !n.deleted);
                                if (validNotes.length > 0) {
                                    const latest = validNotes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
                                    const nextNoteId = latest.id;

                                    // 清空 activeId
                                    this.activeId = null;

                                    // 清空编辑器容器并销毁编辑器
                                    const container = document.getElementById("editor-container");
                                    if (container) container.innerHTML = '';

                                    if (this.editor && typeof this.editor.destroy === 'function') {
                                        this.editor.destroy();
                                    }
                                    this.editor = null;
                                    this.updatePreview("");

                                    // 切换到新笔记 (静默切换，不滚动列表)
                                    this.switch(nextNoteId, false);
                                }
                            }
                        }
                    } catch (e) {
                        console.error('[Delete] 刷新笔记列表失败:', e);
                    }

                    this.render(undefined, true);
                    // 延迟显示删除成功提示，避免被 switch 的状态覆盖
                    setTimeout(() => {
                        this.showToast('笔记已删除');
                    }, 100);
                }, 10);
            } else {
                this.showToast('删除失败，请检查网络连接');
            }
        } catch (e) {
            this.showToast('删除失败，请检查网络连接');
        }
    },

    // 检查重复笔记
    async checkDuplicates() {
        // 创建去重选项对话框
        const existingDialog = document.getElementById('deduplicate-dialog');
        if (existingDialog) {
            existingDialog.remove();
            return;
        }

        const dialog = document.createElement('div');
        dialog.id = 'deduplicate-dialog';
        dialog.setAttribute('data-ms-editor', 'false');
        dialog.className = 'dedup-dialog';

        dialog.innerHTML = `
            <h3 class="dedup-title">选择去重模式</h3>
            <div class="dedup-options">
                <label class="dedup-option">
                    <input type="radio" name="dedup-mode" value="both" checked autocomplete="off">
                    <div>
                        <div class="dedup-option-title">标题和内容完全相同</div>
                        <div class="dedup-option-meta">最严格的去重，推荐使用</div>
                    </div>
                </label>
                <label class="dedup-option">
                    <input type="radio" name="dedup-mode" value="title" autocomplete="off">
                    <div>
                        <div class="dedup-option-title">仅标题相同</div>
                        <div class="dedup-option-meta">内容可能不同，谨慎使用</div>
                    </div>
                </label>
                <label class="dedup-option">
                    <input type="radio" name="dedup-mode" value="content" autocomplete="off">
                    <div>
                        <div class="dedup-option-title">仅内容相同</div>
                        <div class="dedup-option-meta">标题可能不同，谨慎使用</div>
                    </div>
                </label>
            </div>
            <div class="dedup-actions">
                <button id="dedup-cancel" class="dedup-btn dedup-btn-secondary">取消</button>
                <button id="dedup-confirm" class="dedup-btn dedup-btn-primary">开始检查</button>
            </div>
        `;

        document.body.appendChild(dialog);

        // 取消按钮
        dialog.querySelector('#dedup-cancel').onclick = () => dialog.remove();

        // 确认按钮
        dialog.querySelector('#dedup-confirm').onclick = () => {
            const mode = dialog.querySelector('input[name="dedup-mode"]:checked').value;
            if (overlay) overlay.remove();
            dialog.remove();

            // 使用 setTimeout 延迟执行，避开 DOM 移除后的即时变动，给浏览器扩展留出处理时间
            setTimeout(async () => {
                await this.performDuplicateCheck(mode);
            }, 100);
        };

        // 点击背景关闭
        const overlay = document.createElement('div');
        overlay.className = 'dedup-overlay';
        overlay.onclick = () => {
            dialog.remove();
            overlay.remove();
        };
        document.body.appendChild(overlay);
    },

    async performDuplicateCheck(mode) {
        try {
            this.showToast('正在检查重复笔记...', true);

            const response = await fetch(`/api/notes/duplicates?mode=${mode}`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('检查失败');
            }

            const result = await response.json();

            if (result.totalDuplicates === 0) {
                this.showToast('没有发现重复笔记');
                return;
            }

            // 显示重复笔记详情
            const modeText = {
                'both': '标题和内容都相同',
                'title': '标题相同',
                'content': '内容相同'
            };

            let message = `发现 ${result.totalDuplicates} 组重复笔记（${modeText[mode]}）：\n\n`;
            result.duplicates.slice(0, 5).forEach((dup, index) => {
                const title = dup.title || '(无标题)';
                message += `${index + 1}. "${title}" - ${dup.count} 个重复\n`;
            });

            if (result.duplicates.length > 5) {
                message += `\n... 还有 ${result.duplicates.length - 5} 组`;
            }

            message += '\n\n是否执行批量去重？\n（将保留每组中最新的笔记，其他的移至回收站）';

            if (confirm(message)) {
                await this.deduplicateNotes(mode);
            }
        } catch (error) {
            console.error('检查重复笔记失败:', error);
            this.showToast('检查失败，请稍后重试', false);
        }
    },

    // 批量去重笔记
    async deduplicateNotes(mode = 'both') {
        try {
            this.showToast('正在执行去重...', true);

            const response = await fetch('/api/notes/deduplicate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ mode })
            });

            if (!response.ok) {
                throw new Error('去重失败');
            }

            const result = await response.json();

            if (result.success) {
                this.showToast(`去重完成！处理了 ${result.groupsProcessed} 组，移除了 ${result.deletedCount} 个重复笔记`);

                // 重新加载笔记列表
                const res = await fetch('/api/files');
                if (res.ok) {
                    this.notes = await res.json();
                    this.render();
                }
            }
        } catch (error) {
            console.error('批量去重失败:', error);
            this.showToast('去重失败，请稍后重试', false);
        }
    },

    // 滚动控制 - 使用适配器接口
    scrollControl(pos) {
        if (!this.editor) return;

        if (pos === 'top') {
            // 回到顶部
            this.editor.setScrollTop(0);
            const iframe = document.getElementById('preview-frame');
            if (iframe?.contentWindow) {
                iframe.contentWindow.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } else if (pos === 'bottom') {
            // 回到底部
            const scrollHeight = this.editor.getScrollHeight();
            const clientHeight = this.editor.getLayoutInfo().height;
            this.editor.setScrollTop(scrollHeight);
            const iframe = document.getElementById('preview-frame');
            if (iframe?.contentWindow) {
                iframe.contentWindow.scrollTo({ top: iframe.contentWindow.document.documentElement.scrollHeight, behavior: 'smooth' });
            }
        } else if (pos === 'left') {
            // 向上滚动约 80% 视口高度
            const currentScroll = this.editor.getScrollTop();
            const clientHeight = this.editor.getLayoutInfo().height;
            this.editor.setScrollTop(Math.max(0, currentScroll - clientHeight * 0.8));
            const iframe = document.getElementById('preview-frame');
            if (iframe?.contentWindow) {
                iframe.contentWindow.scrollBy({ top: -clientHeight * 0.8, behavior: 'smooth' });
            }
        } else if (pos === 'right') {
            // 向下滚动约 80% 视口高度
            const currentScroll = this.editor.getScrollTop();
            const scrollHeight = this.editor.getScrollHeight();
            const clientHeight = this.editor.getLayoutInfo().height;
            this.editor.setScrollTop(Math.min(scrollHeight, currentScroll + clientHeight * 0.8));
            const iframe = document.getElementById('preview-frame');
            if (iframe?.contentWindow) {
                iframe.contentWindow.scrollBy({ top: clientHeight * 0.8, behavior: 'smooth' });
            }
        }
    },

    // 撤销
    undo() {
        if (!this.editor) return;

        // 使用编辑器适配器的 trigger 方法
        if (this.editor.trigger) {
            this.editor.trigger('keyboard', 'undo');
        }
    },

    // 重做
    redo() {
        if (!this.editor) return;

        // 使用编辑器适配器的 trigger 方法
        if (this.editor.trigger) {
            this.editor.trigger('keyboard', 'redo');
        }
    },

};

enhanceUIAccount(UIManager);
enhanceUIAccountPanel(UIManager);
enhanceUIList(UIManager);
enhanceUIMarker(UIManager);
enhanceUISave(UIManager, fetchWithTimeout);
enhanceUIHistory(UIManager, fetchWithTimeout);
enhanceUIPreviewRenderer(UIManager);
enhanceUIPreview(UIManager);

// 导出
window.ui = UIManager;
