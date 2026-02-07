// UI 核心逻辑模块
import { parseTitleAndCategory } from './utils.js';

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
    isTogglingEditor: false,
    pendingEditorToggle: null,
    _isInitializingEditor: false,
    _pendingEditorInit: null,
    _lastActiveId: null,
    _lastRenderedNotesHash: '', // 用于检测笔记是否真正变化
    _editorLastUpdateTime: 0, // 记录编辑器最后更新的时间戳
    _isComposing: false, // 输入法状态锁
    _isSaving: false, // 防止重复保存

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
            default:
                // 默认灰色
        }
        label.textContent = text || '就绪';
    },

    // 加载主题
    loadTheme() {
        const savedTheme = localStorage.getItem('p-theme');
        if (savedTheme === 'dark') {
            this.toggleTheme();
        } else {
            document.documentElement.classList.add('light-mode');
        }
    },

    // 切换主题
    async toggleTheme() {
        const isDark = document.documentElement.classList.toggle('dark-mode');
        document.documentElement.classList.toggle('light-mode', !isDark);
        localStorage.setItem('p-theme', isDark ? 'dark' : 'light');

        const hlLink = document.getElementById('hljs-style');
        if (hlLink) hlLink.href = isDark ? '/cdn/highlight-dark.min.css' : '/cdn/highlight-light.min.css';

        this.updatePreview();
    },

    // 显示提示 - 使用 CSS 类优化性能
    _toastTimer: null,
    showToast(msg, success = true) {
        const t = document.getElementById('toast');
        if (!t) return;
        
        t.textContent = msg;
        t.className = success ? 'toast-success' : 'toast-error';
        t.style.display = 'block';
        
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { 
            t.style.display = 'none'; 
        }, 1500);
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

    // 切换预览模式
    togglePreview() {
        const mainView = document.getElementById('main-view');
        const previewBtn = document.getElementById('btn-preview');

        if (mainView.className === 'preview-only') {
            mainView.className = 'edit-only';
            previewBtn.title = '预览';
        } else {
            mainView.className = 'preview-only';
            previewBtn.title = '编辑';
            // 切换到预览模式时，强制更新预览
            this.updatePreview(true); // force = true
        }
    },

    // 显示/隐藏行号
    toggleEditor() {
        const container = document.getElementById("editor-container");
        if (!container) return;

        const currentlyEnabled = localStorage.getItem('show-line-numbers') === 'true';
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
    async initEditor(content) {
        // 如果正在使用输入法，不重新初始化
        if (this._isComposing && this.activeId) {
            return;
        }

        // 防抖：如果正在初始化，记录待处理的内容
        if (this._isInitializingEditor) {
            this._pendingEditorInit = content;
            return;
        }

        this._isInitializingEditor = true;
        this._isInitializing = true;
        this._pendingEditorInit = null;

        try {
            const container = document.getElementById("editor-container");
            if (!container) {
                return;
            }

            // 使用适配器系统创建编辑器
            this.editor = await window.EditorAdapterManager.createEditor(container, content, {
                onScroll: () => this.syncScroll(container, 'editor')
            });

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
        } catch (e) {
            console.error('[UI] 编辑器初始化失败:', e);
        } finally {
            // 初始化完成，检查是否有待处理的内容
            this._isInitializingEditor = false;
            this._isInitializing = false;
            if (this._pendingEditorInit !== null && this._pendingEditorInit !== content) {
                const pending = this._pendingEditorInit;
                this._pendingEditorInit = null;
                setTimeout(() => this.initEditor(pending), 100);
            }
        }
    },

    // 更新工具栏按钮显示状态
    updateToolbarButtons() {
        // CodeMirror 专用按钮（显示行号）始终显示
        const editorTypeBtn = document.getElementById('btn-editor-type');
        
        if (editorTypeBtn) editorTypeBtn.style.display = 'flex';
    },

    // 同步滚动
    syncScroll(src, type) {
        if (this.isScrolling || document.getElementById('main-view').className !== 'split') return;
        this.isScrolling = true;
        const iframe = document.getElementById('preview-frame');
        if (!iframe?.contentWindow) return;
        const previewScroll = iframe.contentWindow.document.documentElement;
        if (!previewScroll) {
            this.isScrolling = false;
            return;
        }

        let editorScrollTop = 0;
        let editorScrollHeight = 0;
        let editorClientHeight = 0;

        if (this.editor && this.editor.getScrollTop) {
            editorScrollTop = this.editor.getScrollTop();
            editorScrollHeight = this.editor.getScrollHeight();
            editorClientHeight = this.editor.getLayoutInfo().height;
        } else {
            editorScrollTop = src.scrollTop;
            editorScrollHeight = src.scrollHeight;
            editorClientHeight = src.clientHeight;
        }

        const pct = editorScrollTop / (editorScrollHeight - editorClientHeight);
        if (type === 'editor') previewScroll.scrollTop = pct * (previewScroll.scrollHeight - previewScroll.clientHeight);
        else if (this.editor && this.editor.setScrollTop) {
            this.editor.setScrollTop(pct * (editorScrollHeight - editorClientHeight));
        } else if (src && src.scrollTop !== undefined) {
            src.scrollTop = pct * (src.scrollHeight - src.clientHeight);
        }

        setTimeout(() => { this.isScrolling = false; }, 50);
    },

    // 检测无效附件
    async checkInvalidAttachments(html) {
        // 提取所有附件链接
        const attachmentRegex = /(src|href)=["']\/api\/attachments\/raw\/([^"']+)["']/ig;
        const attachments = [];
        let match;

        while ((match = attachmentRegex.exec(html)) !== null) {
            attachments.push({
                type: match[1],
                path: match[2]
            });
        }

        if (attachments.length === 0) {
            return; // 没有附件，无需检测
        }



        // 批量检测附件是否有效
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
                console.error('[Attachment] 检测附件失败:', attachment.path, error);
            }
        });

        await Promise.all(checkPromises);

        // 如果有无效附件，显示提示
        if (invalidAttachments.length > 0) {
            const message = `检测到 ${invalidAttachments.length} 个无效附件：\n${invalidAttachments.map(a => `• ${a.path}`).join('\n')}`;

            // 可以选择显示 Toast 提示
            // this.showToast(message, false);
        }
    },

    // 更新预览 - 优化版，减少抖动
    _previewDebounceTimer: null,
    _lastPreviewContent: '', // 缓存上次的预览内容
    _lastPreviewHTML: '', // 缓存上次渲染的HTML内容

    updatePreview(force = false) {
        // 检查是否在分屏或预览模式
        const mainView = document.getElementById('main-view');
        const viewMode = mainView ? mainView.className : '';
        const isPreviewVisible = viewMode === 'split' || viewMode === 'preview-only';

        // 如果预览不可见，不执行更新
        if (!isPreviewVisible && !force) {
            return;
        }

        // 获取当前内容
        let txt = "";
        if (this.editor && this.editor.getValue) {
            txt = this.editor.getValue();
        }

        // 如果内容没有变化，跳过
        if (txt === this._lastPreviewContent && !force) {
            return;
        }

        // 清除之前的定时器
        if (this._previewDebounceTimer) {
            clearTimeout(this._previewDebounceTimer);
        }

        // 防抖延迟：300ms 让预览更新更平滑
        const delay = force ? 0 : 300;

        this._previewDebounceTimer = setTimeout(() => {
            this._doUpdatePreview(txt, force);
        }, delay);
    },

    // 实际执行预览更新
    _doUpdatePreview(txt, force = false) {
        if (!txt) return;

        // 重新获取最新内容（因为可能有新的输入）
        if (this.editor && this.editor.getValue) {
            txt = this.editor.getValue();
        }

        // 如果内容没有变化，跳过
        if (txt === this._lastPreviewContent && !force) {
            return;
        }
        this._lastPreviewContent = txt;

        let html = marked.parse(txt);
        html = html.replace(/(src|href)=["']\/api\/uploads\/([^"']+)["']/ig, (m, p1, p2) => {
            return `${p1}="/api/attachments/raw/${encodeURIComponent(p2)}"`;
        });

        // 如果内容完全相同，跳过
        if (html === this._lastPreviewHTML && !force) {
            return;
        }
        this._lastPreviewHTML = html;

        // 检测无效附件（异步，不阻塞渲染）
        this.checkInvalidAttachments(html);

        const iframe = document.getElementById('preview-frame');
        if (!iframe) return;

        // 直接更新 iframe
        this._updateIframeContent(iframe, html);
    },

    // 更新iframe内容
    _updateIframeContent(iframe, html) {
        // 检查 iframe 是否已经有内容
        try {
            const win = iframe.contentWindow;
            const doc = win.document;
            const contentDiv = doc.getElementById('content');

            // 如果已经有内容，只更新内容部分
            if (contentDiv && doc.readyState === 'complete') {
                contentDiv.innerHTML = html;

                // 重新运行代码高亮
                if (win.hljs) {
                    win.hljs.highlightAll();
                }

                // 重新绑定复制按钮
                doc.querySelectorAll('pre').forEach(pre => {
                    if (!pre.querySelector('.copy-code-btn')) {
                        const btn = doc.createElement('button');
                        btn.className = 'copy-code-btn';
                        btn.innerText = '复制';
                        btn.onclick = () => {
                            const code = pre.querySelector('code').innerText;
                            navigator.clipboard.writeText(code);
                            btn.innerText = '已复制';
                            setTimeout(() => btn.innerText = '复制', 2000);
                        };
                        pre.appendChild(btn);
                    }
                });

                return;
            }
        } catch (e) {
            // 跨域限制或其他错误
        }

        // 首次加载或无法直接更新时，使用 srcdoc
        this._setIframeSrcDoc(iframe, html);
    },

    // 设置 iframe 的 srcdoc
    _setIframeSrcDoc(iframe, html) {
        const isLight = document.documentElement.classList.contains('light-mode');
        const bodyBg = isLight ? '#ffffff' : '#0d1117';
        const bodyColor = isLight ? '#24292f' : '#e6edf3';
        const preBg = isLight ? '#f6f8fa' : '#161b22';
        const btnBg = isLight ? '#f6f8fa' : '#30363d';
        const hlStyle = isLight ? '/cdn/highlight-light.min.css' : '/cdn/highlight-dark.min.css';

        iframe.srcdoc = `<!DOCTYPE html><html><head>
            <meta charset="UTF-8">
            <link rel="stylesheet" href="${hlStyle}">
            <style>
                body { background: ${bodyBg} !important; padding: 20px; margin: 0; color: ${bodyColor} !important; overflow-x: hidden; }
                .markdown-body { background: transparent !important; color: ${bodyColor} !important; }
                .markdown-body img, .markdown-body > img { max-width: 100% !important; height: auto !important; display: block; }
                .markdown-body pre, .markdown-body code { background-color: ${preBg} !important; }
                pre { position: relative; border: 1px solid ${isLight ? '#d0d7de':'#30363d'}; border-radius: 6px; padding: 16px !important; }
                .copy-code-btn { position: absolute; top: 8px; right: 8px; padding: 4px 8px; background: ${btnBg}; color: ${bodyColor}; border: 1px solid ${isLight ? '#d0d7de':'#30363d'}; border-radius: 4px; cursor: pointer; font-size: 11px; }
            .attachment-preview { margin: 15px 0; border: 1px solid ${isLight ? '#d0d7de':'#30363d'}; border-radius: 8px; overflow: hidden; background: ${preBg}; }
            .attachment-info { padding: 10px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid ${isLight ? '#d0d7de':'#30363d'}; }
            .attachment-name { color: ${bodyColor}; font-weight: bold; overflow: hidden; text-overflow: ellipsis; }
            .dl-link { color: var(--accent); text-decoration: none; font-size: 12px; }
            .pdf-preview { width: 100%; height: 500px; border: none; }
            video, audio { width: 100%; display: block; }
        </style>
    </head><body class="markdown-body">
        <div id="content">${html}</div>
        <script src="/cdn/highlight.min.js"><\/script>
        <script>
            window.onload = () => {
                if(window.hljs) hljs.highlightAll();
                document.querySelectorAll('pre').forEach(pre => {
                    const btn = document.createElement('button');
                    btn.className = 'copy-code-btn'; btn.innerText = '复制';
                    btn.onclick = () => {
                        const code = pre.querySelector('code').innerText;
                        navigator.clipboard.writeText(code);
                        btn.innerText = '已复制';
                        setTimeout(() => btn.innerText = '复制', 2000);
                    };
                    pre.appendChild(btn);
                });
                document.querySelectorAll('a').forEach(a => {
                    const url = a.getAttribute('href');
                    if(!url || !url.includes('.')) return;
                    const ext = url.split('.').pop().toLowerCase();
                    const fileName = a.innerText || '附件';
                    let previewEl = null;
                    if(ext === 'pdf') {
                        previewEl = document.createElement('iframe');
                        previewEl.className = 'pdf-preview';
                        previewEl.src = url;
                    } else if(['mp4', 'webm', 'ogg', 'mov'].includes(ext)) {
                        previewEl = document.createElement('video');
                        previewEl.controls = true;
                        previewEl.src = url;
                    } else if(['mp3', 'wav', 'm4a', 'aac'].includes(ext)) {
                        previewEl = document.createElement('audio');
                        previewEl.controls = true;
                        previewEl.src = url;
                    }
                    if(previewEl) {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'attachment-preview';
                        wrapper.innerHTML = '<div class="attachment-info"><span class="attachment-name">📄 ' + fileName + '</span><a class="dl-link" href="' + url + '" download>下载原文</a></div>';
                        wrapper.appendChild(previewEl);
                        a.parentNode.replaceChild(wrapper, a);
                    } else {
                        if(url.startsWith('/uploads/') || url.startsWith('http')) {
                           a.style.color = '#58a6ff';
                           a.innerHTML = '📎 ' + fileName + ' <small style="opacity:0.6; font-weight:normal">(' + url + ')</small>';
                        }
                    }
                });
            };
        <\/script>
    </body></html>`;
    },

    // 保存笔记 - 使用防抖减少频繁写入
    _saveDebounceTimer: null,
    _isSaving: false, // 防止重复保存

    async save() {
        // 输入法期间完全禁止保存
        if (this._isComposing) {
            return;
        }
        if (!this.activeId || !this.editor || this._isSaving) {
            return;
        }

        clearTimeout(this._saveDebounceTimer);
        this._saveDebounceTimer = setTimeout(async () => {
            await this._doSave();
        }, 1500); // 增加到1500ms，与编辑器保持一致
    },
    
    // 实际保存逻辑 - 云端优先
    async _doSave() {
        if (!this.activeId || !this.editor) return;

        // 二次检查输入法状态，确保不会在输入时保存
        if (this._isComposing) {
            console.warn('[UI] 输入法正在进行中，跳过保存');
            return;
        }

        let content = "";
        if (this.editor.getValue) {
            content = this.editor.getValue();
        }

        const idx = this.notes.findIndex(x => x.id.toString() === this.activeId.toString());
        if (idx === -1) return;

        // 检查是否是临时笔记且内容为空
        const currentNote = this.notes[idx];
        if (currentNote.isTemp && (!content || content.trim().length === 0)) {
            // 删除临时笔记
            this.notes = this.notes.filter(n => n.id.toString() !== this.activeId.toString());

            // 切换到第一个有内容的笔记
            const notesWithContent = this.notes.filter(n => {
                if (n.deleted) return false;
                const hasContent = n.content && n.content.trim().length > 0;
                const hasRealTitle = n.title && n.title !== '新笔记';
                return hasContent || hasRealTitle;
            });

            if (notesWithContent.length > 0) {
                const latest = notesWithContent.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
                this.switch(latest.id);
            } else {
                this.activeId = null;
                if (this.editor) this.editor.destroy();
                this.updatePreview("");
            }

            this.render();
            return;
        }

        // 如果是临时笔记且有内容，转为正式笔记
        if (currentNote.isTemp && content && content.trim().length > 0) {
            currentNote.isTemp = false;
        }

        // 智能标题和分类更新
        const currentTitle = this.notes[idx].title;
        let finalTitle = currentTitle;
        const { fullTitle: newFullTitle } = parseTitleAndCategory(content);

        // 如果是新笔记或标题为默认标题，直接使用解析的标题
        if (!currentTitle || currentTitle === '新笔记' || currentTitle === '未命名') {
            finalTitle = newFullTitle;
        } else {
            // 对于已有标题的笔记，检查内容第一行是否与当前标题一致
            const currentHasCategory = currentTitle.includes('/');
            const newHasCategory = newFullTitle.includes('/');

            const currentCategory = currentHasCategory ? currentTitle.split('/')[0].trim() : '';
            const currentPureTitle = currentHasCategory ? currentTitle.split('/').slice(1).join('/').trim() : currentTitle.trim();

            const newCategory = newHasCategory ? newFullTitle.split('/')[0].trim() : '';
            const newPureTitle = newHasCategory ? newFullTitle.split('/').slice(1).join('/').trim() : newFullTitle.trim();

            // 如果分类或标题任一个变化了，就更新
            if (currentCategory !== newCategory || currentPureTitle !== newPureTitle) {
                finalTitle = newFullTitle;
            }
        }

        const now = Date.now();
        this.notes[idx] = {
            ...this.notes[idx],
            content,
            title: finalTitle,
            updatedAt: now,
            isTemp: false
        };

        // 更新编辑器最后修改时间
        this._editorLastUpdateTime = now;

        // 直接调用API保存到云端
        await this.saveToCloud(this.notes[idx]);
    },

    // 保存到云端
    async saveToCloud(note) {
        try {
            // 输入法期间完全禁止云端同步
            if (this._isComposing) {
                return;
            }

            const res = await fetch('/api/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: note.id,
                    title: note.title,
                    content: note.content,
                    updatedAt: note.updatedAt
                })
            });

            if (res.ok) {
                const result = await res.json();
                // 更新本地笔记数据，但要小心不要覆盖用户正在编辑的内容
                const idx = this.notes.findIndex(n => n.id.toString() === note.id.toString());
                if (idx !== -1 && result.note) {
                    // 只有当保存时间戳匹配时才更新，避免覆盖更新的内容
                    if (result.note.updatedAt === note.updatedAt) {
                        this.notes[idx] = result.note;
                    } else {
                        // 服务器返回的时间戳不同，只更新服务器时间戳和ID
                        this.notes[idx] = {
                            ...this.notes[idx],
                            id: result.note.id,
                            updatedAt: result.note.updatedAt
                        };
                    }
                }
                // 不调用 render()，避免触发 DOM 更新影响编辑器
            } else {
                this.showToast('保存失败，请检查网络连接');
            }
        } catch (e) {
            this.showToast('保存失败，请检查网络连接');
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

    // 标记编辑器有新修改（用于冲突检测）
    markEditorModified() {
        this._editorLastUpdateTime = Date.now();

    },

    // 渲染笔记列表（优化版本，减少闪烁）
    render(limit = 100, force = false) {
        const q = document.getElementById('search').value.toLowerCase();
        const list = document.getElementById('list');
        if (!list) return;

        // 如果笔记数据没有变化且不是强制渲染，则跳过渲染
        const currentHash = this._calculateNotesHash(this.notes);
        if (!force && currentHash === this._lastRenderedNotesHash) return;
        this._lastRenderedNotesHash = currentHash;

        // 使用文档片段减少重绘
        const fragment = document.createDocumentFragment();
        const groups = {};

        // 过滤和排序 - 单次遍历
        const filtered = [];
        for (const n of this.notes) {
            if (n.deleted) continue;
            if (!q || n.title.toLowerCase().includes(q) || (n.content && n.content.toLowerCase().includes(q))) {
                filtered.push(n);
            }
        }
        filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        const displayNotes = q ? filtered : filtered.slice(0, limit);

        // 分组
        for (const n of displayNotes) {
            let folder = '未分类';
            if (n.title && n.title.includes('/')) {
                const firstPart = n.title.split('/')[0];
                folder = firstPart.replace(/^#*\s*/, '').trim() || '未分类';
            }
            if (!groups[folder]) groups[folder] = [];
            groups[folder].push(n);
        }

        // 渲染
        const sortedFolders = Object.keys(groups).sort();
        for (const folder of sortedFolders) {
            const isCollapsed = this.collapsedFolders.has(folder);

            // 所有文件夹都显示头部，包括"未分类"
            const fHead = document.createElement('div');
            fHead.className = 'folder-item ' + (isCollapsed ? 'collapsed' : '');
            fHead.style.cssText = 'display: flex !important; justify-content: space-between; align-items: center;';

            // 给整个文件夹头部添加点击事件
            fHead.onclick = () => {
                this.toggleFolder(folder);
            };

            // 文件夹名称
            const fName = document.createElement('span');
            fName.textContent = folder;
            fName.style.flex = '1';
            fName.style.cursor = 'pointer';
            fHead.appendChild(fName);

            // 分享按钮（只有分类文件夹才显示）
            if (folder !== '未分类') {
                const shareBtn = document.createElement('button');
                shareBtn.className = 'tool-btn';
                shareBtn.textContent = '分享';
                shareBtn.style.cssText = 'font-size:10px;padding:2px 6px;margin-left:4px;';
                shareBtn.onclick = (e) => {
                    e.stopPropagation();
                    api.shareCategory(folder);
                };
                fHead.appendChild(shareBtn);
            }

            fragment.appendChild(fHead);

            const fContent = document.createElement('div');
            fContent.className = 'folder-content ' + (isCollapsed ? 'hidden' : '');

            for (const n of groups[folder]) {
                const el = document.createElement('div');
                el.className = "note-item " + (n.id.toString() === this.activeId?.toString() ? 'active' : '');

                // 提取纯标题
                let displayTitle = n.title || '无标题';
                if (displayTitle.includes('/')) {
                    displayTitle = displayTitle.split('/').slice(1).join('/').trim();
                }

                // 使用事件委托，减少事件监听器数量
                el.dataset.id = n.id;
                el.dataset.title = displayTitle;

                // 复选框和标题的HTML
                const checkbox = this.batchMode ? `<input type="checkbox" class="note-checkbox" ${this.selectedIds.has(n.id.toString()) ? 'checked' : ''}>` : '';
                const shareBtnHtml = !this.batchMode ? `<span class="note-action-share" title="分享">🔗</span><span class="note-action-delete" title="删除">×</span>` : '';
                el.innerHTML = `${checkbox}<div class="note-info">${displayTitle}</div>${shareBtnHtml}`;

                fContent.appendChild(el);
            }
            fragment.appendChild(fContent);
        }

        // 处理空状态
        if (displayNotes.length === 0) {
            const isOnline = navigator.onLine;
            const emptyHTML = isOnline ?
                `<div style="padding:40px;text-align:center;color:var(--gray);">
                    <div style="font-size:40px;margin-bottom:16px">📝</div>
                    <div style="font-size:14px">还没有笔记</div>
                    <div style="font-size:12px;color:var(--gray);margin-top:8px">点击"新建笔记"开始记录</div>
                 </div>` :
                `<div style="padding:40px;text-align:center;color:var(--gray);">
                    <div style="font-size:40px;margin-bottom:16px">📴</div>
                    <div style="font-size:14px">离线模式</div>
                    <div style="font-size:12px;color:var(--gray);margin-top:8px">当前无本地缓存<br/>点击"新建笔记"可离线创建，连接网络后同步</div>
                 </div>`;
            list.innerHTML = emptyHTML;
            return;
        }

        // 添加加载更多按钮
        if (filtered.length > limit && !q) {
            const moreBtn = document.createElement('div');
            moreBtn.style.cssText = "padding:12px;text-align:center;font-size:12px;color:var(--accent);cursor:pointer";
            moreBtn.textContent = `加载更多 (${filtered.length - limit})...`;
            moreBtn.onclick = () => this.render(limit + 200);
            fragment.appendChild(moreBtn);
        }

        // 一次性添加所有元素，减少重绘
        list.innerHTML = '';
        list.appendChild(fragment);

        // 使用事件委托，绑定到列表容器
        this._setupListEventDelegation(list);
    },

    // 设置列表事件委托
    _setupListEventDelegation(list) {
        // 移除旧的事件监听器
        if (this._listEventHandler) {
            list.removeEventListener('click', this._listEventHandler);
        }

        // 创建新的事件处理函数
        this._listEventHandler = (e) => {
            const noteItem = e.target.closest('.note-item');
            if (!noteItem) return;

            const noteId = noteItem.dataset.id;

            // 处理复选框点击
            if (e.target.classList.contains('note-checkbox')) {
                e.stopPropagation();
                this.toggleSelect(noteId, e);
                return;
            }

            // 处理分享按钮点击
            if (e.target.classList.contains('note-action-share')) {
                e.stopPropagation();
                api.shareNoteById(noteId);
                return;
            }

            // 处理删除按钮点击
            if (e.target.classList.contains('note-action-delete')) {
                e.stopPropagation();
                ui.del(noteId);
                return;
            }

            // 处理笔记项点击（切换笔记）
            this.switch(noteId);
            if (window.innerWidth <= 768) {
                this.toggleSidebar();
            }
        };

        // 绑定事件委托
        list.addEventListener('click', this._listEventHandler);
    },

    // 切换笔记
    switch(id) {
        const newId = id.toString();

        // 如果是同一个笔记，不重复初始化
        if (this.activeId === newId) {
            return;
        }

        // 如果正在输入，先提醒用户
        if (this._isComposing) {
            return;
        }

        // 如果编辑器正在初始化，取消并等待
        if (this._isInitializingEditor) {
            this._pendingEditorInit = null;
            return;
        }

        this._lastActiveId = newId;
        this.activeId = newId;

        const n = this.notes.find(x => x.id.toString() === this.activeId);

        if (n) {
            this.initEditor(n.content || '');
            // 延迟渲染，等待编辑器初始化
            requestAnimationFrame(() => {
                this.render(undefined, true);
            });
        }
    },

    // 创建笔记 - 云端优先
    async create() {
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
                this.notes.unshift(note);
                this.render();
                this.switch(note.id);
            } else {
                console.error('[Create] 创建失败:', res.status);
                this.showToast('创建失败，请检查网络连接');
            }
        } catch (e) {
            console.error('[Create] 创建异常:', e);
            this.showToast('创建失败，请检查网络连接');
        }
    },

    // 删除笔记 - 云端优先
    async del(id) {
        const nid = id.toString();

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

                                    // 切换到新笔记
                                    this.switch(nextNoteId);
                                }
                            }
                        }
                    } catch (e) {
                        console.error('[Delete] 刷新笔记列表失败:', e);
                    }

                    this.render(undefined, true);
                    this.showToast('笔记已删除');
                }, 10);
            } else {
                this.showToast('删除失败，请检查网络连接');
            }
        } catch (e) {
            console.error('[Delete] 删除异常:', e);
            this.showToast('删除失败，请检查网络连接');
        }
    },

    // 防抖渲染
    debounceRender() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.render(9999, true), 200);
    },

    // 切换文件夹
    toggleFolder(folder) {
        if (this.collapsedFolders.has(folder)) {
            this.collapsedFolders.delete(folder);
        } else {
            this.collapsedFolders.add(folder);
        }
        this.render(9999, true);
    },

    // 折叠/展开所有文件夹
    toggleAllFolders(expand) {
        const q = document.getElementById('search').value.toLowerCase();
        const filtered = [];
        for (const n of this.notes) {
            if (n.deleted) continue;
            if (!q || n.title.toLowerCase().includes(q) || (n.content && n.content.toLowerCase().includes(q))) {
                filtered.push(n);
            }
        }

        // 获取所有文件夹
        const folders = new Set();
        for (const n of filtered) {
            let folder = '未分类';
            if (n.title && n.title.includes('/')) {
                const firstPart = n.title.split('/')[0];
                folder = firstPart.replace(/^#*\s*/, '').trim() || '未分类';
            }
            folders.add(folder);
        }

        // 折叠或展开所有文件夹
        if (expand) {
            // 展开所有：清空折叠集合
            this.collapsedFolders.clear();
        } else {
            // 折叠所有：添加所有文件夹到折叠集合（包括"未分类"）
            folders.forEach(folder => {
                this.collapsedFolders.add(folder);
            });
        }

        this.render(9999, true);
    },

    // 切换批量模式
    toggleBatchMode() {
        this.batchMode = !this.batchMode;
        this.selectedIds.clear();
        document.getElementById('sidebar').classList.toggle('batch-mode', this.batchMode);
        document.getElementById('batch-bar').style.display = this.batchMode ? 'flex' : 'none';
        if (this.batchMode) {
            // 重置全选复选框
            const selectAllCheckbox = document.getElementById('batch-select-all');
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
        }
        // 强制重新渲染以显示/隐藏复选框
        this.render(undefined, true);
    },

    // 切换选择
    toggleSelect(id, e) {
        e.stopPropagation();
        const sid = id.toString();
        const wasSelected = this.selectedIds.has(sid);

        if (wasSelected) {
            this.selectedIds.delete(sid);
        } else {
            this.selectedIds.add(sid);
        }

        // 使用 requestAnimationFrame 优化更新
        requestAnimationFrame(() => {
            document.getElementById('batch-count').innerText = "已选 " + this.selectedIds.size;
            // 更新全选复选框状态
            this.updateSelectAllCheckbox();
        });
    },

    // 全选/取消全选
    batchSelectAll(checked) {
        if (checked) {
            // 全选：选中所有未删除的笔记
            this.notes.forEach(n => {
                if (!n.deleted) {
                    this.selectedIds.add(n.id.toString());
                }
            });
        } else {
            // 取消全选
            this.selectedIds.clear();
        }
        document.getElementById('batch-count').innerText = "已选 " + this.selectedIds.size;
        this.render();
    },

    // 更新全选复选框状态
    updateSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('batch-select-all');
        if (!selectAllCheckbox) return;

        const totalNotes = this.notes.filter(n => !n.deleted).length;
        const selectedCount = this.selectedIds.size;

        if (selectedCount === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        } else if (selectedCount === totalNotes) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        }
    },

    // 批量删除
    async batchDelete() {
        if (this.selectedIds.size === 0) return;
        const selectedCount = this.selectedIds.size;
        if (!confirm(`确定删除选中的 ${selectedCount} 篇笔记？`)) return;

        // 显示删除中的提示
        this.updateStatus('working', '删除中...');

        // 直接调用API批量删除
        try {
            const res = await fetch('/api/notes/batch-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids: Array.from(this.selectedIds)
                })
            });

            if (res.ok) {
                // 从本地列表中移除
                this.notes = this.notes.filter(n => !this.selectedIds.has(n.id.toString()));

                // 使用 requestAnimationFrame 优化渲染
                requestAnimationFrame(() => {
                    this.toggleBatchMode();
                    this.render();
                    this.showToast(`已批量删除 ${selectedCount} 篇笔记`);
                    this.updateStatus('success', '已删除');
                    setTimeout(() => {
                        this.updateStatus('idle', '就绪');
                    }, 1500);
                });
            } else {
                console.error('[BatchDelete] 删除失败:', res.status);
                this.showToast('批量删除失败，请检查网络连接');
                this.updateStatus('error', '删除失败');
            }
        } catch (e) {
            console.error('[BatchDelete] 删除异常:', e);
            this.showToast('批量删除失败，请检查网络连接');
            this.updateStatus('error', '删除失败');
        }
    },

    // 批量移动
    async batchMove() {
        if (this.selectedIds.size === 0) return;
        
        const folderName = prompt("请输入目标目录名称（留空则移至根目录）：", "");
        if (folderName === null) return;
        
        const cleanFolderName = folderName.trim().replace(/\//g, '');
        const now = Date.now();
        
        // 保存选中的数量和ID列表，因为 toggleBatchMode 会清空 selectedIds
        const selectedCount = this.selectedIds.size;
        const selectedIdList = Array.from(this.selectedIds);
        
        let updatedCount = 0;
        
        // 保存当前打开的笔记ID
        const activeIdStr = this.activeId ? this.activeId.toString() : null;
        let updatedActiveNote = null;
        
        this.notes = this.notes.map(n => {
            const noteId = n.id.toString();
            if (selectedIdList.includes(noteId)) {
                // 从内容第一行解析纯标题（去掉分类前缀）
                let pureTitle = '';
                if (n.content) {
                    const firstLine = n.content.split('\n')[0] || '';
                    const cleanLine = firstLine.replace(/^#+\s*/, '').trim();
                    if (cleanLine.includes('/')) {
                        pureTitle = cleanLine.split('/').slice(1).join('/').trim();
                    } else {
                        pureTitle = cleanLine;
                    }
                }
                
                // 如果解析失败，回退到从 title 解析
                if (!pureTitle) {
                    pureTitle = n.title.includes('/') ? n.title.split('/').pop() : n.title;
                }
                
                const newTitle = cleanFolderName ? `${cleanFolderName}/${pureTitle}` : pureTitle;
                
                // 同步更新内容的第一行
                let newContent = n.content || '';
                if (newContent) {
                    const lines = newContent.split('\n');
                    if (lines.length > 0) {
                        const firstLine = lines[0];
                        const headingMatch = firstLine.match(/^(#{1,6}\s*)/);
                        const headingPrefix = headingMatch ? headingMatch[1] : '';
                        lines[0] = headingPrefix + newTitle;
                        newContent = lines.join('\n');
                    }
                } else {
                    newContent = '# ' + newTitle;
                }
                
                updatedCount++;
                const updatedNote = { ...n, title: newTitle, content: newContent, updatedAt: now, isUnsynced: true };
                
                // 如果这是当前打开的笔记，保存引用
                if (noteId === activeIdStr) {
                    updatedActiveNote = updatedNote;
                }
                
                return updatedNote;
            }
            return n;
        });

        // 直接调用API保存移动后的笔记到云端
        for (const note of this.notes) {
            if (note.isUnsynced) {
                await this.saveToCloud(note);
            }
        }

        // 如果当前打开的笔记被移动，更新编辑器
        if (updatedActiveNote && this.editor) {
            if (this.editor.setValue) {
                this.editor.setValue(updatedActiveNote.content || '');
            }
            this.updatePreview();
        }

        // 渲染列表显示新分类
        this.render(undefined, true);

        // 退出批量模式
        this.toggleBatchMode();

        this.showToast(`已成功移动 ${selectedCount} 篇笔记`);
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

    // 加载用户信息
    _isLoadingUserInfo: false,

    async loadUserInfo() {
        // 防止重复加载
        if (this._isLoadingUserInfo) {
            return;
        }

        this._isLoadingUserInfo = true;

        try {
            const res = await fetch('/api/user-info');
            if (!res.ok) throw new Error('Failed to load user info');
            const data = await res.json();

            // 更新用户显示
            const userDisplay = document.getElementById('user-display');
            if (userDisplay) {
                userDisplay.textContent = `用户: ${data.username}`;
            }

            // 更新邮箱显示
            const emailDisplay = document.getElementById('user-email-display');
            if (emailDisplay) {
                if (data.email) {
                    emailDisplay.textContent = `邮箱: ${data.email}`;
                } else {
                    emailDisplay.textContent = '邮箱: 未绑定';
                }
            }

            // 显示管理后台链接（如果是管理员）
            const adminLink = document.getElementById('admin-link');
            if (adminLink) {
                if (data.isAdmin) {
                    adminLink.style.display = 'inline';
                } else {
                    adminLink.style.display = 'none';
                }
            }

            // 更新笔记配额
            const noteUsage = document.getElementById('note-usage-text');
            const noteBar = document.getElementById('note-bar');
            if (noteUsage && noteBar && data.noteLimit) {
                const noteSize = parseFloat(data.noteUsage || 0);
                const notePercent = Math.min((noteSize / data.noteLimit) * 100, 100);
                noteUsage.textContent = `${Math.round(noteSize)}MB/${Math.round(data.noteLimit)}MB`;
                noteBar.style.width = `${notePercent}%`;
            }

            // 更新附件配额
            const fileUsage = document.getElementById('file-usage-text');
            const fileBar = document.getElementById('file-bar');
            if (fileUsage && fileBar && data.fileLimit) {
                const fileSize = parseFloat(data.fileUsage || 0);
                const filePercent = Math.min((fileSize / data.fileLimit) * 100, 100);
                fileUsage.textContent = `${Math.round(fileSize)}MB/${Math.round(data.fileLimit)}MB`;
                fileBar.style.width = `${filePercent}%`;
            }
        } catch (e) {
            console.error('加载用户信息失败:', e);
        } finally {
            this._isLoadingUserInfo = false;
        }
    },

    // 刷新用户信息（用于操作后更新，但不重复请求）
    refreshUserInfo() {
        // 使用 debounce 避免频繁刷新
        clearTimeout(this._refreshUserInfoTimer);
        this._refreshUserInfoTimer = setTimeout(() => {
            this.loadUserInfo();
        }, 500);
    },

    // 退出登录
    async logout() {
        if (!confirm('确定要退出登录吗？')) return;
        try {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login.html';
        } catch (e) {
            console.error('退出失败:', e);
            window.location.href = '/login.html';
        }
    },

    // 显示回收站
    showTrash() {
        const modal = document.getElementById('trash-modal');
        if (modal) {
            modal.classList.add('show');
            this.loadTrash();
        }
    },

    // 加载回收站列表
    async loadTrash() {
        const listBody = document.getElementById('trash-list-body');
        listBody.innerHTML = '<div style="text-align:center;padding:20px;">加载中...</div>';

        try {
            const res = await fetch('/api/notes/trash');
            if (res.ok) {
                const notes = await res.json();
                if (notes.length === 0) {
                    listBody.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray);">回收站为空</div>';
                    return;
                }

                // 使用循环构建 HTML
                let html = '';
                for (const note of notes) {
                    const noteIdStr = String(note.id);
                    html += `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${note.title || '无标题'}</div>
                            <div style="font-size:11px;color:var(--gray);margin-top:2px;">${new Date(note.updatedAt).toLocaleString('zh-CN')}</div>
                        </div>
                        <div style="display:flex;gap:8px;flex-shrink:0;">
                            <button class="restore-note-btn" data-note-id="${noteIdStr}" style="background:var(--green);color:#fff;border:none;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:12px;">恢复</button>
                            <button class="delete-note-btn" data-note-id="${noteIdStr}" style="background:var(--red);color:#fff;border:none;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:12px;">永久删除</button>
                        </div>
                    </div>`;
                }
                listBody.innerHTML = html;

                // 绑定事件监听器
                listBody.querySelectorAll('.restore-note-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const noteId = e.target.getAttribute('data-note-id');
                        this.restoreNote(noteId);
                    });
                });

                listBody.querySelectorAll('.delete-note-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const noteId = e.target.getAttribute('data-note-id');
                        this.deleteNoteFromTrash(noteId);
                    });
                });
            } else {
                const data = await res.json();
                listBody.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red);">加载失败: ${data.error || '未知错误'}</div>`;
            }
        } catch (e) {
            console.error('[回收站] 加载失败:', e);
            listBody.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red);">网络错误: ${e.message}</div>`;
        }
    },

    // 恢复笔记
    async restoreNote(id) {
        if (!confirm('确定要恢复这篇笔记吗？')) return;

        try {
            const res = await fetch(`/api/notes/${id}/restore`, { method: 'PUT' });
            if (res.ok) {
                this.showToast('笔记已恢复');
                this.loadTrash();
                // 重新加载笔记列表
                const notesRes = await fetch('/api/files');
                if (notesRes.ok) {
                    this.notes = await notesRes.json() || [];
                    this.render();
                }
            } else {
                const data = await res.json();
                this.showToast('恢复失败: ' + (data.error || '未知错误'), false);
            }
        } catch (e) {
            this.showToast('操作失败，请检查网络', false);
        }
    },

    // 从回收站永久删除
    async deleteNoteFromTrash(id) {
        if (!confirm('确定要永久删除这篇笔记吗？此操作不可撤销。')) return;

        try {
            const res = await fetch(`/api/notes/${id}/permanent`, { method: 'DELETE' });
            if (res.ok) {
                this.showToast('已永久删除');
                this.loadTrash();
                // 重新加载笔记列表
                const notesRes = await fetch('/api/files');
                if (notesRes.ok) {
                    this.notes = await notesRes.json() || [];
                    this.render();
                }
            } else {
                const data = await res.json();
                this.showToast('删除失败: ' + (data.error || '未知错误'), false);
            }
        } catch (e) {
            this.showToast('操作失败，请检查网络', false);
        }
    },

    // 清理回收站
    async emptyTrash() {
        if (!confirm('确定要清空回收站吗？此操作不可撤销。')) return;
        try {
            const res = await fetch('/api/notes/trash/empty', { method: 'DELETE' });
            if (res.ok) {
                this.showToast('回收站已清空');
                // 重新加载笔记列表
                this.loadTrash();
                // 重新加载笔记
                const notesRes = await fetch('/api/files');
                if (notesRes.ok) {
                    this.notes = await notesRes.json() || [];
                    this.render();
                }
            } else {
                const data = await res.json();
                this.showToast('清空失败: ' + (data.error || '未知错误'), false);
            }
        } catch (e) {
            this.showToast('操作失败，请检查网络', false);
        }
    },

    // 打开邮箱绑定模态框
    promptBindEmail() {
        const modal = document.getElementById('email-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.getElementById('modal-email-input').value = '';
            document.getElementById('modal-code-input').value = '';
            document.getElementById('modal-send-btn').textContent = '发送验证码';
            document.getElementById('modal-send-btn').disabled = false;
        }
    },

    // 关闭邮箱绑定模态框
    closeEmailModal() {
        const modal = document.getElementById('email-modal');
        if (modal) modal.style.display = 'none';
    },

    // 发送验证码
    async modalSendCode() {
        const email = document.getElementById('modal-email-input').value.trim();
        if (!email || !email.includes('@')) {
            this.showToast('请输入正确的邮箱地址');
            return;
        }

        const btn = document.getElementById('modal-send-btn');
        btn.disabled = true;

        try {
            const res = await fetch('/api/send-bind-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            if (res.ok) {
                this.showToast('验证码已发送');
                // 显示第二步输入框
                document.getElementById('modal-step2').style.display = 'block';
                let count = 60;
                btn.textContent = `${count}秒后重试`;
                const timer = setInterval(() => {
                    count--;
                    if (count <= 0) {
                        clearInterval(timer);
                        btn.disabled = false;
                        btn.textContent = '发送验证码';
                    } else {
                        btn.textContent = `${count}秒后重试`;
                    }
                }, 1000);
            } else {
                const data = await res.json();
                this.showToast(data.error || '发送失败');
                btn.disabled = false;
            }
        } catch (e) {
            console.error('发送验证码失败:', e);
            this.showToast('发送失败');
            btn.disabled = false;
        }
    },

    // 验证并绑定邮箱
    async modalVerifyCode() {
        const email = document.getElementById('modal-email-input').value.trim();
        const code = document.getElementById('modal-code-input').value.trim();

        if (!email || !code) {
            this.showToast('请填写邮箱和验证码');
            return;
        }

        try {
            const res = await fetch('/api/verify-bind-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, token: code })
            });

            if (res.ok) {
                this.showToast('邮箱绑定成功');
                this.closeEmailModal();
                this.loadUserInfo();
            } else {
                const data = await res.json();
                this.showToast(data.error || '绑定失败');
            }
        } catch (e) {
            console.error('绑定邮箱失败:', e);
            this.showToast('绑定失败');
        }
    }
};

// 导出
window.ui = UIManager;
