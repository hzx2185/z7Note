// UI 核心逻辑模块
import { fetchWithTimeout } from './utils.js';
import { enhanceUIAccount } from './ui-account.js';
import { enhanceUIAccountPanel } from './ui-account-panel.js';
import { enhanceUIList } from './ui-list.js';
import { enhanceUIMarker } from './ui-marker.js';
import { enhanceUIPreview } from './ui-preview.js';

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
    currentLimit: 50, // 新增：保存当前的限制条目数
    _isInitializingEditor: false,
    _pendingEditorInit: null,
    _lastActiveId: null,
    _lastRenderedNotesHash: '', // 用于检测笔记是否真正变化
    _editorLastUpdateTime: 0, // 记录编辑器最后更新的时间戳
    _isComposing: false, // 输入法状态锁
    _isSaving: false, // 防止重复保存
    _markedLoadingPromise: null, // 渲染引擎加载状态

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
                this._isInitializingEditor = false;
                this._isInitializing = false;
                return;
            }

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
            this.editor = await window.EditorAdapterManager.createEditor(container, content, {
                onScroll: () => this.syncScroll(container, 'editor')
            });

            if (this.editor) {
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
                // 附件检测失败，静默处理
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


    // 确保渲染引擎已加载
    async ensureMarkedLoaded() {
        if (window.marked && typeof DOMPurify !== 'undefined') return true;
        if (this._markedLoadingPromise) return this._markedLoadingPromise;

        this._markedLoadingPromise = (async () => {
            try {
                // 并行加载 marked, dompurify
                const loaders = [
                    window.loadScript('/cdn/marked.min.js'),
                    window.loadScript('/cdn/dompurify.min.js')
                ];
                
                // 如果 highlight 还没加载，也带上
                if (typeof hljs === 'undefined') {
                    loaders.push(window.loadScript('/cdn/highlight.min.js'));
                }

                await Promise.all(loaders);
                return true;
            } catch (e) {
                console.error('Failed to load rendering engines:', e);
                this._markedLoadingPromise = null;
                return false;
            }
        })();

        return this._markedLoadingPromise;
    },

    // 实际执行预览更新
    async _doUpdatePreview(txt, force = false) {
        if (!txt) return;

        // 重新获取最新内容（因为可能有新的输入）
        if (this.editor && this.editor.getValue) {
            txt = this.editor.getValue();
        }

        // 如果内容没有变化，跳过
        if (txt === this._lastPreviewContent && !force) {
            return;
        }
        
        // 确保渲染引擎已就绪
        const loaded = await this.ensureMarkedLoaded();
        if (!loaded) return;

        this._lastPreviewContent = txt;

        let html = marked.parse(txt);
        
        // 使用 DOMPurify 净化 HTML，防止 XSS 攻击
        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html, {
                ALLOWED_TAGS: ['a', 'b', 'i', 'em', 'strong', 'code', 'pre', 'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'br', 'hr', 'input', 'del', 's', 'u', 'sup', 'sub'],
                ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'name', 'type', 'checked', 'disabled', 'width', 'height', 'target', 'rel'],
                ALLOW_DATA_ATTR: false
            });
        }
        
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

        // 获取附件预览配置
        const attachmentConfig = window.parent.ui ? window.parent.ui.attachmentPreviewConfig : {
            pdfMaxSize: 10,
            videoMaxSize: 50,
            audioMaxSize: 20,
            lazyLoad: true,
            autoLoad: false,
        };

        iframe.srcdoc = `<!DOCTYPE html><html><head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <link rel="stylesheet" href="${hlStyle}">
            <style>
                * {
                    box-sizing: border-box;
                }
                html, body {
                    width: 100%;
                    height: 100%;
                    margin: 0;
                    padding: 0;
                    overflow-x: hidden;
                }
                body { background: ${bodyBg} !important; padding: 20px; margin: 0; color: ${bodyColor} !important; overflow-x: hidden; }
                .markdown-body { background: transparent !important; color: ${bodyColor} !important; width: 100%; max-width: 100%; }
                .markdown-body img, .markdown-body > img { max-width: 100% !important; height: auto !important; display: block; }
                .markdown-body pre, .markdown-body code { background-color: ${preBg} !important; }
                pre { position: relative; border: 1px solid ${isLight ? '#d0d7de':'#30363d'}; border-radius: 6px; padding: 16px !important; }
                .copy-code-btn { position: absolute; top: 8px; right: 8px; padding: 4px 8px; background: ${btnBg}; color: ${bodyColor}; border: 1px solid ${isLight ? '#d0d7de':'#30363d'}; border-radius: 4px; cursor: pointer; font-size: 11px; }
            .attachment-preview { margin: 15px 0; border: 1px solid ${isLight ? '#d0d7de':'#30363d'}; border-radius: 8px; overflow: hidden; background: ${preBg}; width: 100%; max-width: 100%; }
            .attachment-info { padding: 10px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid ${isLight ? '#d0d7de':'#30363d'}; }
            .attachment-name { color: ${bodyColor}; font-weight: bold; overflow: hidden; text-overflow: ellipsis; }
            .dl-link { color: var(--accent); text-decoration: none; font-size: 12px; }
            .pdf-preview { width: 100% !important; max-width: 100% !important; height: 70vh; min-height: 400px; max-height: 800px; border: none; display: block; overflow: hidden; }
            .pdf-preview object { width: 100% !important; max-width: 100% !important; height: 100% !important; min-height: 100% !important; max-height: 100% !important; border: none; display: block; }
            .pdf-placeholder { width: 100% !important; max-width: 100% !important; height: 70vh; min-height: 400px; max-height: 800px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; }
            .pdf-placeholder:hover { background-color: ${isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)'}; }
            .pdf-placeholder-icon { font-size: 48px; margin-bottom: 12px; }
            .pdf-placeholder-text { font-size: 14px; color: ${bodyColor}; opacity: 0.7; }
            .pdf-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 70vh; min-height: 400px; max-height: 800px; width: 100% !important; max-width: 100% !important; }
            .pdf-loading-spinner { width: 32px; height: 32px; border: 3px solid ${isLight ? '#d0d7de':'#30363d'}; border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
            @keyframes spin { to { transform: rotate(360deg); } }
            .pdf-loading-text { margin-top: 12px; font-size: 14px; color: ${bodyColor}; opacity: 0.7; }
                .file-too-large { padding: 20px; text-align: center; color: var(--accent); font-size: 13px; }
                .preview-download-wrap { margin-top: 10px; }
                .preview-download-link { color: var(--accent); }
                .attachment-link-meta { opacity: 0.6; font-weight: normal; }
            .attachment-media { width: 100% !important; max-width: 100% !important; display: block; }
            .attachment-video { height: auto; }
            .attachment-audio { }
            .attachment-link { color: var(--accent); }
            .media-placeholder { width: 100% !important; max-width: 100% !important; min-height: 100px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; }
            .media-placeholder:hover { background-color: ${isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)'}; }
            .media-placeholder-icon { font-size: 40px; margin-bottom: 8px; }
            .media-placeholder-text { font-size: 13px; color: ${bodyColor}; opacity: 0.7; }

            /* 响应式设计 - 移动端优化 */
            @media (max-width: 768px) {
                body { padding: 10px !important; }
                .attachment-info { padding: 8px; font-size: 12px; flex-direction: column; align-items: flex-start; gap: 8px; }
                .dl-link { font-size: 11px; align-self: flex-end; }
                .pdf-preview { height: 60vh !important; min-height: 300px; max-height: 600px; width: 100% !important; max-width: 100% !important; }
                .pdf-placeholder { height: 60vh !important; min-height: 300px; max-height: 600px; width: 100% !important; max-width: 100% !important; }
                .pdf-placeholder-icon { font-size: 36px; }
                .pdf-placeholder-text { font-size: 12px; }
                .pdf-loading { height: 60vh !important; min-height: 300px; max-height: 600px; width: 100% !important; max-width: 100% !important; }
                .pdf-loading-spinner { width: 28px; height: 28px; }
                .pdf-loading-text { font-size: 12px; }
                .file-too-large { padding: 15px; font-size: 12px; }
                .media-placeholder { min-height: 80px; width: 100% !important; max-width: 100% !important; }
                .media-placeholder-icon { font-size: 32px; }
                .media-placeholder-text { font-size: 11px; }
            }

            /* 超小屏幕优化 */
            @media (max-width: 480px) {
                body { padding: 8px !important; }
                .attachment-info { padding: 6px; font-size: 11px; }
                .pdf-preview { height: 50vh !important; min-height: 250px; max-height: 500px; width: 100% !important; max-width: 100% !important; }
                .pdf-placeholder { height: 50vh !important; min-height: 250px; max-height: 500px; width: 100% !important; max-width: 100% !important; }
                .pdf-placeholder-icon { font-size: 32px; }
                .pdf-placeholder-text { font-size: 11px; }
                .pdf-loading { height: 50vh !important; min-height: 250px; max-height: 500px; width: 100% !important; max-width: 100% !important; }
                .pdf-loading-spinner { width: 24px; height: 24px; }
                .pdf-loading-text { font-size: 11px; }
            }
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

                // 监听来自父窗口的resize消息
                window.addEventListener('message', (event) => {
                    if (event.data.type === 'resize') {
                        // 收到 iframe resize 消息
                        // 可以在这里添加额外的调整逻辑
                    }
                });

                document.querySelectorAll('a').forEach(a => {
                    const url = a.getAttribute('href');
                    if(!url || !url.includes('.')) return;
                    const ext = url.split('.').pop().toLowerCase();
                    const fileName = a.innerText || '附件';
                    let previewEl = null;
                    let shouldLazyLoad = ${attachmentConfig.lazyLoad};
                    let autoLoad = ${attachmentConfig.autoLoad};

                    // PDF文件处理：添加懒加载和文件大小检查
                    if(ext === 'pdf') {
                        // 创建PDF占位符
                        const placeholder = document.createElement('div');
                        placeholder.className = 'pdf-placeholder';
                        placeholder.innerHTML = '<div class="pdf-placeholder-icon">📄</div><div class="pdf-placeholder-text">点击加载PDF预览</div>';

                        // 点击加载PDF
                        placeholder.onclick = async () => {
                            // 显示加载状态
                            placeholder.innerHTML = '<div class="pdf-loading"><div class="pdf-loading-spinner"></div><div class="pdf-loading-text">加载中...</div></div>';

                            try {
                                // 检查文件大小（使用配置的最大值）
                                const maxSize = ${attachmentConfig.pdfMaxSize} * 1024 * 1024;
                                const response = await fetch(url, { method: 'HEAD' });
                                const size = parseInt(response.headers.get('content-length'));

                                if (size > maxSize) {
                                    // 文件过大，显示提示
                                    placeholder.innerHTML = '<div class="file-too-large">⚠️ 文件过大（' + (size / 1024 / 1024).toFixed(2) + 'MB），建议下载查看</div>';
                                    return;
                                }

                                // 由于iframe嵌套问题，使用object标签代替iframe
                                const object = document.createElement('object');
                                object.className = 'pdf-preview';
                                object.setAttribute('data', url);
                                object.setAttribute('type', 'application/pdf');

                                // 添加data属性用于调试
                                object.setAttribute('data-pdf-viewer', 'true');
                                object.setAttribute('data-time', Date.now().toString());

                                // 添加错误处理
                                let isLoaded = false;
                                let loadTimeout;

                                const showError = (message) => {
                                    if (!isLoaded) {
                                        isLoaded = true;
                                        clearTimeout(loadTimeout);
                                        placeholder.innerHTML = '<div class="file-too-large">❌ ' + message + '</div><div class="preview-download-wrap"><a href="' + url + '" download class="preview-download-link">点击下载PDF</a></div>';
                                    }
                                };

                                object.onerror = () => {
                                    showError('PDF加载失败');
                                };

                                // object元素没有onload事件，使用onloadend
                                object.onload = () => {
                                    isLoaded = true;
                                    clearTimeout(loadTimeout);
                                    // PDF加载成功
                                };

                                // 设置15秒超时
                                loadTimeout = setTimeout(() => {
                                    if (!isLoaded) {
                                        console.warn('PDF加载超时');
                                        showError('PDF加载超时，请尝试下载查看');
                                    }
                                }, 15000);

                                // 替换占位符
                                placeholder.replaceWith(object);
                            } catch (error) {
                                placeholder.innerHTML = '<div class="file-too-large">❌ 加载失败，请尝试下载查看</div><div class="preview-download-wrap"><a href="' + url + '" download class="preview-download-link">点击下载PDF</a></div>';
                            }
                        };

                        previewEl = placeholder;
                    }
                    // 视频文件处理：添加懒加载
                    else if(['mp4', 'webm', 'ogg', 'mov'].includes(ext)) {
                        // 创建视频占位符
                        const placeholder = document.createElement('div');
                        placeholder.className = 'media-placeholder';
                        placeholder.innerHTML = '<div class="media-placeholder-icon">🎬</div><div class="media-placeholder-text">点击加载视频</div>';

                        // 点击加载视频
                        placeholder.onclick = async () => {
                            try {
                                // 检查文件大小
                                const maxSize = ${attachmentConfig.videoMaxSize} * 1024 * 1024;
                                const response = await fetch(url, { method: 'HEAD' });
                                const size = parseInt(response.headers.get('content-length'));

                                if (size > maxSize) {
                                    alert('视频文件过大（' + (size / 1024 / 1024).toFixed(2) + 'MB），建议下载查看');
                                    return;
                                }

                                const video = document.createElement('video');
                                video.className = 'attachment-media attachment-video';
                                video.controls = true;
                                video.src = url;
                                placeholder.replaceWith(video);
                            } catch (error) {
                                alert('加载视频失败: ' + error.message);
                            }
                        };

                        previewEl = placeholder;
                    }
                    // 音频文件处理：添加懒加载
                    else if(['mp3', 'wav', 'm4a', 'aac'].includes(ext)) {
                        // 创建音频占位符
                        const placeholder = document.createElement('div');
                        placeholder.className = 'media-placeholder';
                        placeholder.innerHTML = '<div class="media-placeholder-icon">🎵</div><div class="media-placeholder-text">点击加载音频</div>';

                        // 点击加载音频
                        placeholder.onclick = async () => {
                            try {
                                // 检查文件大小
                                const maxSize = ${attachmentConfig.audioMaxSize} * 1024 * 1024;
                                const response = await fetch(url, { method: 'HEAD' });
                                const size = parseInt(response.headers.get('content-length'));

                                if (size > maxSize) {
                                    alert('音频文件过大（' + (size / 1024 / 1024).toFixed(2) + 'MB），建议下载查看');
                                    return;
                                }

                                const audio = document.createElement('audio');
                                audio.className = 'attachment-media attachment-audio';
                                audio.controls = true;
                                audio.src = url;
                                placeholder.replaceWith(audio);
                            } catch (error) {
                                alert('加载音频失败: ' + error.message);
                            }
                        };

                        previewEl = placeholder;
                    }

                    if(previewEl) {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'attachment-preview';
                        wrapper.innerHTML = '<div class="attachment-info"><span class="attachment-name">📄 ' + fileName + '</span><a class="dl-link" href="' + url + '" download>下载原文</a></div>';
                        wrapper.appendChild(previewEl);
                        a.parentNode.replaceChild(wrapper, a);

                        // 如果需要懒加载，设置Intersection Observer
                        if (shouldLazyLoad && 'IntersectionObserver' in window) {
                            const observer = new IntersectionObserver((entries) => {
                                entries.forEach(entry => {
                                    if (entry.isIntersecting) {
                                        // 如果配置为自动加载，则点击占位符
                                        if (autoLoad) {
                                            const placeholder = entry.target.querySelector('.pdf-placeholder, .media-placeholder');
                                            if (placeholder) {
                                                placeholder.click();
                                            }
                                        }
                                        observer.unobserve(entry.target);
                                    }
                                });
                            }, { threshold: 0.1 });
                            observer.observe(wrapper);
                        } else if (autoLoad) {
                            // 如果不支持Intersection Observer但配置为自动加载，直接点击
                            const placeholder = wrapper.querySelector('.pdf-placeholder, .media-placeholder');
                            if (placeholder) {
                                setTimeout(() => placeholder.click(), 100);
                            }
                        }
                    } else {
                        if(url.startsWith('/uploads/') || url.startsWith('http')) {
                           a.classList.add('attachment-link');
                           a.innerHTML = '📎 ' + fileName + ' <small class="attachment-link-meta">(' + url + ')</small>';
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
    _scheduledSavePromise: null,
    _scheduledSaveResolve: null,
    _scheduledSaveReject: null,
    _lastSavedSignature: '',
    _saveCooldownUntil: 0,
    _saveFailureCount: 0,
    
    _consumeScheduledSaveSettlers() {
        const resolve = this._scheduledSaveResolve;
        const reject = this._scheduledSaveReject;
        this._scheduledSavePromise = null;
        this._scheduledSaveResolve = null;
        this._scheduledSaveReject = null;
        return { resolve, reject };
    },

    _resolveScheduledSave(result = true) {
        const { resolve } = this._consumeScheduledSaveSettlers();
        if (resolve) resolve(result);
    },

    _rejectScheduledSave(error) {
        const { reject } = this._consumeScheduledSaveSettlers();
        if (reject) reject(error);
    },

    _getSaveDebounceDelay() {
        const host = window.location.hostname;
        if (host === '127.0.0.1' || host === 'localhost') {
            return 3000;
        }
        return 10000;
    },

    _getSaveCooldownMs() {
        const host = window.location.hostname;
        if (host === '127.0.0.1' || host === 'localhost') {
            return 4000;
        }
        return 8000;
    },

    _buildNoteSignature(note, contentOverride) {
        if (!note) return '';
        const content = contentOverride !== undefined ? contentOverride : (note.content || '');
        return `${note.id}|${note.title || ''}|${content}`;
    },

    normalizeTimestamp(ts) {
        if (ts === null || ts === undefined || ts === '') return null;
        if (typeof ts === 'string') {
            const parsed = Date.parse(ts);
            if (!Number.isFinite(parsed) || parsed <= 0) return null;
            return parsed;
        }
        const num = Number(ts);
        if (!Number.isFinite(num) || num <= 0) return null;
        return num > 10000000000 ? num : num * 1000;
    },

    formatTimestamp(ts) {
        const normalized = this.normalizeTimestamp(ts);
        return normalized ? new Date(normalized).toLocaleString('zh-CN') : '-';
    },

    formatCompactTimestamp(ts) {
        const normalized = this.normalizeTimestamp(ts);
        if (!normalized) return '-';
        const date = new Date(normalized);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${month}-${day} ${hours}:${minutes}`;
    },

    updateNoteMeta(note) {
        const metaEl = document.getElementById('note-meta');
        if (!metaEl) return;
        if (!note) {
            metaEl.textContent = '';
            metaEl.title = '';
            return;
        }
        const createdFull = this.formatTimestamp(note.createdAt);
        const updatedFull = this.formatTimestamp(note.updatedAt);
        const createdCompact = this.formatCompactTimestamp(note.createdAt);
        const updatedCompact = this.formatCompactTimestamp(note.updatedAt);
        metaEl.title = `创建：${createdFull} · 修改：${updatedFull}`;
        metaEl.textContent = window.innerWidth <= 640
            ? `改 ${updatedCompact}`
            : `创 ${createdCompact} · 改 ${updatedCompact}`;
    },

    _captureActiveNoteSnapshot() {
        if (!this.activeId) return null;
        const idx = this.notes.findIndex(x => x.id.toString() === this.activeId.toString());
        if (idx === -1) return null;

        const note = this.notes[idx];
        const content = this.editor && this.editor.getValue ? this.editor.getValue() : (note.content || '');
        return {
            ...note,
            content
        };
    },

    _hasPendingSave() {
        const snapshot = this._captureActiveNoteSnapshot();
        if (!snapshot) return false;
        return this._buildNoteSignature(snapshot, snapshot.content) !== this._lastSavedSignature;
    },

    async flushPendingSave(options = {}) {
        clearTimeout(this._saveDebounceTimer);
        const snapshot = options.noteSnapshot || this._captureActiveNoteSnapshot();
        if (!snapshot) {
            this._resolveScheduledSave(true);
            return true;
        }
        if (this._buildNoteSignature(snapshot, snapshot.content) === this._lastSavedSignature) {
            this._resolveScheduledSave(true);
            return true;
        }
        try {
            const result = await this._saveSnapshot(snapshot, options);
            this._resolveScheduledSave(result);
            return result;
        } catch (error) {
            this._rejectScheduledSave(error);
            throw error;
        }
    },

    async save() {
        // 输入法期间完全禁止保存
        if (this._isComposing) {
            return false;
        }
        if (!this.activeId || !this.editor) {
            return false;
        }
        if (!this._hasPendingSave()) {
            return true;
        }

        clearTimeout(this._saveDebounceTimer);
        if (!this._scheduledSavePromise) {
            this._scheduledSavePromise = new Promise((resolve, reject) => {
                this._scheduledSaveResolve = resolve;
                this._scheduledSaveReject = reject;
            });
        }
        const debounceDelay = this._getSaveDebounceDelay();
        const cooldownDelay = Math.max(0, this._saveCooldownUntil - Date.now());
        const finalDelay = Math.max(debounceDelay, cooldownDelay);

        this._saveDebounceTimer = setTimeout(async () => {
            try {
                const result = await this._doSave();
                this._resolveScheduledSave(result);
            } catch (error) {
                this._rejectScheduledSave(error);
            }
        }, finalDelay);

        return this._scheduledSavePromise;
    },
    
    // 实际保存逻辑 - 云端优先
    async _doSave(options = {}) {
        if (!this.activeId || !this.editor) return false;

        // 二次检查输入法状态，确保不会在输入时保存
        if (this._isComposing) {
            return false;
        }

        const snapshot = this._captureActiveNoteSnapshot();
        if (!snapshot) return false;
        if (this._buildNoteSignature(snapshot, snapshot.content) === this._lastSavedSignature) return true;
        return await this._saveSnapshot(snapshot, options);
    },

    async _saveSnapshot(snapshot, options = {}) {
        if (!snapshot || snapshot.id === undefined || snapshot.id === null) return false;

        const idx = this.notes.findIndex(x => x.id.toString() === snapshot.id.toString());
        if (idx === -1) return false;

        const content = snapshot.content || '';
        const currentNote = this.notes[idx];
        const isCurrentActiveNote = this.activeId && this.activeId.toString() === snapshot.id.toString();

        // 检查是否是临时笔记且内容为空
        if (currentNote.isTemp && (!content || content.trim().length === 0)) {
            // 删除临时笔记
            this.notes = this.notes.filter(n => n.id.toString() !== snapshot.id.toString());

            // 切换到第一个有内容的笔记
            const notesWithContent = this.notes.filter(n => {
                if (n.deleted) return false;
                const hasContent = n.content && n.content.trim().length > 0;
                const hasRealTitle = n.title && n.title !== '新笔记';
                return hasContent || hasRealTitle;
            });

            if (notesWithContent.length > 0) {
                const latest = notesWithContent.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
                if (isCurrentActiveNote) {
                    this.switch(latest.id);
                }
            } else {
                if (isCurrentActiveNote) {
                    this.activeId = null;
                    if (this.editor) this.editor.destroy();
                    this.updatePreview("");
                }
            }

            this.render();
            return true;
        }

        // 如果是临时笔记且有内容，转为正式笔记
        if (currentNote.isTemp && content && content.trim().length > 0) {
            currentNote.isTemp = false;
        }

        // 保存笔记，标题不变（用户需要手工修改标题）
        const now = Math.floor(Date.now() / 1000);
        const createdAt = this.notes[idx].createdAt || currentNote.createdAt || now;
        this.notes[idx] = {
            ...this.notes[idx],
            content,
            createdAt,
            updatedAt: now,
            isTemp: false
        };
        if (this.notes[idx].id === this.activeId) {
            this.updateNoteMeta(this.notes[idx]);
        }

        // 更新编辑器最后修改时间
        this._editorLastUpdateTime = now * 1000; // UI 内部计时仍可保留 ms 用于防抖比较，但在 note 结构中存秒

        // 直接调用API保存到云端
        return await this.saveToCloud(this.notes[idx], 1, options);
    },

    _isSaving: false,
    _pendingSave: null,

    // 保存到云端
    async saveToCloud(note, attempt = 1, options = {}) {
        // 如果正在保存，将当前笔记存入等待队列，确保最后一次修改不丢失
        if (this._isSaving) {
            this._pendingSave = note;
            return 'queued';
        }

        try {
            // 输入法期间完全禁止云端同步
            if (this._isComposing) {
                return false;
            }

            this._isSaving = true;
            // 修正：后端 /api/files 期望接收数组格式
            const res = await fetchWithTimeout('/api/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                keepalive: Boolean(options.keepalive),
                body: JSON.stringify([{
                    id: note.id,
                    title: note.title,
                    content: note.content,
                    createdAt: note.createdAt,
                    updatedAt: note.updatedAt
                }])
            }, 20000);

            const contentType = res.headers.get('content-type');
            let result;
            if (contentType && contentType.includes('application/json')) {
                result = await res.json();
            }

            if (res.ok && result) {
                // 更新本地笔记数据
                const noteToUpdate = Array.isArray(result.notes) ? result.notes[0] : result.note;
                const idx = this.notes.findIndex(n => n.id.toString() === note.id.toString());
                if (idx !== -1 && noteToUpdate) {
                    if (noteToUpdate.updatedAt === note.updatedAt) {
                        this.notes[idx] = noteToUpdate;
                    } else {
                        this.notes[idx] = {
                            ...this.notes[idx],
                            id: noteToUpdate.id,
                            updatedAt: noteToUpdate.updatedAt
                        };
                    }
                }
                const latestNote = this.notes[idx] || noteToUpdate || note;
                if (latestNote && latestNote.id === this.activeId) {
                    this.updateNoteMeta(latestNote);
                }
                this._lastSavedSignature = this._buildNoteSignature(latestNote);
                this._saveFailureCount = 0;
                this._saveCooldownUntil = 0;
                return true;
            } else {
                if (res.status === 502 && attempt < 2) {
                    console.warn('[Save] 网关异常，准备重试一次');
                    await new Promise(resolve => setTimeout(resolve, 2500));
                    this._isSaving = false;
                    return await this.saveToCloud(note, attempt + 1, options);
                }
                this._saveFailureCount += 1;
                this._saveCooldownUntil = Date.now() + this._getSaveCooldownMs();
                console.error('[Save] 服务器返回错误:', res.status);
                this.showToast(res.status === 502 ? '保存通道不稳定，请稍后重试' : '保存失败，请检查网络连接', false);
                return false;
            }
        } catch (e) {
            if ((e.message === '请求超时' || e.name === 'AbortError') && attempt < 2) {
                console.warn('[Save] 保存超时，准备重试一次');
                await new Promise(resolve => setTimeout(resolve, 2500));
                this._isSaving = false;
                return await this.saveToCloud(note, attempt + 1, options);
            }
            this._saveFailureCount += 1;
            this._saveCooldownUntil = Date.now() + this._getSaveCooldownMs();
            console.error('[Save] 请求异常:', e);
            this.showToast('无法连接服务器，请稍后重试', false);
                return false;
        } finally {
            this._isSaving = false;
            // 如果在保存期间有新的修改，立即执行最后一次待办保存
            if (this._pendingSave) {
                const nextNote = this._pendingSave;
                this._pendingSave = null;
                void this.saveToCloud(nextNote);
            }
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

    // 切换笔记 (shouldScroll 参数控制是否滚动列表)
    switch(id, shouldScroll = true) {
        const newId = id.toString();

        // 如果是同一个笔记，不重复初始化
        if (this.activeId === newId) {
            // 依然更新激活状态（以防列表刚重绘完）
            this.updateActiveStatus(shouldScroll);
            return;
        }

        // 如果正在输入，先提醒用户
        if (this._isComposing) {
            return;
        }

        if (this.activeId && this.editor && this._hasPendingSave()) {
            void this.flushPendingSave({ noteSnapshot: this._captureActiveNoteSnapshot() });
        }

        this._lastActiveId = newId;
        this.activeId = newId;

        // 切换笔记时清除标记
        this.clearMarker();

        const n = this.notes.find(x => x.id.toString() === this.activeId);

        if (n) {
            // 自动展开笔记所在的文件夹
            let folder = '未分类';
            if (n.title && n.title.includes('_')) {
                folder = n.title.split('_')[0].replace(/^#*\s*/, '').trim() || '未分类';
            }
            if (this.collapsedFolders.has(folder)) {
                this.collapsedFolders.delete(folder);
                this.render(undefined, true);
            }

            // 更新标题输入框 - 恢复全标题模式
            const titleInput = document.getElementById('note-title-input');
            if (titleInput) titleInput.value = n.title || '';

            this._lastSavedSignature = this._buildNoteSignature(n, n.content || '');
            this.updateNoteMeta(n);

            this.initEditor(n.content || '');
            
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
                this.showToast('创建失败，请检查网络连接');
            }
        } catch (e) {
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
enhanceUIPreview(UIManager);

// 导出
window.ui = UIManager;
