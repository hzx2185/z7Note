// UI 核心逻辑模块
import { fetchWithTimeout } from './utils.js';

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

    // 打开专用预览窗口
    async openDedicatedPreview() {
        const modal = document.getElementById('dedicated-preview-modal');
        const iframe = document.getElementById('dedicated-preview-frame');
        if (!modal || !iframe) return;

        // 获取当前编辑器内容并渲染
        let txt = "";
        if (this.editor && this.editor.getValue) {
            txt = this.editor.getValue();
        }

        // 确保引擎已加载
        await this.ensureMarkedLoaded();

        // 渲染 Markdown
        let html = "";
        if (window.marked) {
            html = marked.parse(txt);
            // 应用安全过滤和图片路径修正
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
        }
        // 设置 iframe 内容
        this._setIframeSrcDoc(iframe, html);
        
        // 显示模态框
        modal.style.display = 'flex';
    },

    // 关闭专用预览窗口
    closeDedicatedPreview() {
        const modal = document.getElementById('dedicated-preview-modal');
        if (modal) modal.style.display = 'none';
    },

    // 从模态框打印
    printPreviewFromModal() {
        const iframe = document.getElementById('dedicated-preview-frame');
        if (!iframe?.contentWindow) return;
        
        const win = iframe.contentWindow;
        win.focus();
        win.print();
    },

    // 打印预览 (保留旧方法作为备选)
    printPreview() {
        const iframe = document.getElementById('preview-frame');
        if (!iframe) return;

        // 确保预览内容是最新的
        this.updatePreview(true);

        // 给一点点时间让 iframe 渲染完成
        setTimeout(() => {
            try {
                const win = iframe.contentWindow;
                if (!win) return;
                
                // 设置打印样式
                const style = win.document.createElement('style');
                style.innerHTML = `
                    @media print {
                        body { padding: 0 !important; }
                        .copy-code-btn, .pdf-placeholder, .media-placeholder { display: none !important; }
                        pre { white-space: pre-wrap !important; word-break: break-all !important; }
                    }
                `;
                win.document.head.appendChild(style);

                win.focus();
                win.print();
            } catch (e) {
                console.error('打印失败:', e);
                // 如果直接打印失败（如跨域等原因），尝试在新窗口打开
                const content = iframe.srcdoc;
                const printWin = window.open('', '_blank');
                if (printWin) {
                    printWin.document.write(content);
                    printWin.document.close();
                    printWin.onload = () => {
                        printWin.focus();
                        printWin.print();
                    };
                }
            }
        }, 500);
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
            video, audio { width: 100% !important; max-width: 100% !important; display: block; }
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
                                object.style.border = 'none';
                                object.style.width = '100%';
                                object.style.maxWidth = '100%';
                                object.style.display = 'block';
                                object.style.overflow = 'hidden';
                                object.style.height = '70vh';
                                object.style.minHeight = '400px';
                                object.style.maxHeight = '800px';
                                object.style.transition = 'height 0.3s ease';
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
                                        placeholder.innerHTML = '<div class="file-too-large">❌ ' + message + '</div><div style="margin-top:10px;"><a href="' + url + '" download style="color:var(--accent);">点击下载PDF</a></div>';
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
                                placeholder.innerHTML = '<div class="file-too-large">❌ 加载失败，请尝试下载查看</div><div style="margin-top:10px;"><a href="' + url + '" download style="color:var(--accent);">点击下载PDF</a></div>';
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
                                video.controls = true;
                                video.src = url;
                                video.style.width = '100%';
                                video.style.maxWidth = '100%';
                                video.style.height = 'auto';
                                video.style.display = 'block';
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
                                audio.controls = true;
                                audio.src = url;
                                audio.style.width = '100%';
                                audio.style.maxWidth = '100%';
                                audio.style.display = 'block';
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
        this.notes[idx] = {
            ...this.notes[idx],
            content,
            updatedAt: now,
            isTemp: false
        };

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
                this._lastSavedSignature = this._buildNoteSignature(this.notes[idx] || noteToUpdate || note);
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

    // 渲染笔记列表（支持文件夹分组与增量加载）
    render(limit, force = false, isLoadMore = false) {
        const q = document.getElementById('search').value.toLowerCase();
        const list = document.getElementById('list');
        if (!list) return;

        // 默认不再分布显示，改为全量或大数量（除非指定了limit）
        if (limit === undefined) {
            limit = 9999; 
        }
        this.currentLimit = limit;

        // 保存当前滚动位置 (仅在非加载更多模式下需要)
        const currentScroll = list.scrollTop;

        // 如果笔记数据没有变化且不是强制渲染且不是加载更多，则跳过渲染
        const currentHash = this._calculateNotesHash(this.notes);
        if (!force && !isLoadMore && currentHash === this._lastRenderedNotesHash) return;
        this._lastRenderedNotesHash = currentHash;

        // 过滤和排序
        const filtered = [];
        for (const n of this.notes) {
            if (n.deleted) continue;
            if (!q || n.title.toLowerCase().includes(q) || (n.content && n.content.toLowerCase().includes(q))) {
                filtered.push(n);
            }
        }
        filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        // 如果是增量加载，我们只关心新增的部分
        const displayNotes = q ? filtered : filtered.slice(0, limit);
        
        // 分组并记录每个分组的最大更新时间
        const groups = {};
        const folderMaxTime = {}; // 记录每个分类下最新的更新时间
        for (const n of displayNotes) {
            let folder = '未分类';
            if (n.title && n.title.includes('_')) {
                const parts = n.title.split('_');
                folder = parts[0].replace(/^#*\s*/, '').trim() || '未分类';
            }
            if (!groups[folder]) {
                groups[folder] = [];
                folderMaxTime[folder] = 0;
            }
            groups[folder].push(n);
            
            // 更新该分类的最晚修改时间
            const time = n.updatedAt || 0;
            if (time > folderMaxTime[folder]) {
                folderMaxTime[folder] = time;
            }
        }

        if (!isLoadMore) {
            list.innerHTML = '';
        } else {
            const oldMoreBtn = list.querySelector('.load-more-btn');
            if (oldMoreBtn) oldMoreBtn.remove();
        }

        const fragment = document.createDocumentFragment();
        // 修改排序逻辑：按分类下最新笔记的修改时间降序排列
        const sortedFolders = Object.keys(groups).sort((a, b) => {
            return folderMaxTime[b] - folderMaxTime[a];
        });

        for (const folder of sortedFolders) {
            const isCollapsed = this.collapsedFolders.has(folder);
            
            // 查找或创建文件夹
            let fContent = list.querySelector(`.folder-content[data-folder="${folder}"]`);
            if (!fContent) {
                const fHead = document.createElement('div');
                fHead.className = 'folder-item ' + (isCollapsed ? 'collapsed' : '');
                fHead.style.cssText = 'display: flex !important; justify-content: space-between; align-items: center;';
                fHead.onclick = () => this.toggleFolder(folder);

                const fName = document.createElement('span');
                fName.textContent = folder;
                fName.style.flex = '1';
                fName.style.cursor = 'pointer';
                fHead.appendChild(fName);

                if (folder !== '未分类') {
                    const shareBtn = document.createElement('button');
                    shareBtn.className = 'tool-btn';
                    shareBtn.textContent = '分享';
                    shareBtn.style.cssText = 'font-size:10px;padding:2px 6px;margin-left:4px;';
                    shareBtn.onclick = (e) => { e.stopPropagation(); api.shareCategory(folder); };
                    fHead.appendChild(shareBtn);
                }

                fragment.appendChild(fHead);

                fContent = document.createElement('div');
                fContent.className = 'folder-content ' + (isCollapsed ? 'hidden' : '');
                fContent.dataset.folder = folder;
                fragment.appendChild(fContent);
            }

            for (const n of groups[folder]) {
                if (list.querySelector(`.note-item[data-id="${n.id}"]`)) continue;

                const el = document.createElement('div');
                el.className = "note-item " + (n.id.toString() === this.activeId?.toString() ? 'active' : '');
                
                let displayTitle = n.title || '无标题';
                if (displayTitle.includes('_')) {
                    displayTitle = displayTitle.split('_').slice(1).join('_').trim();
                }

                el.dataset.id = n.id;
                el.dataset.title = displayTitle;
                el.dataset.fullTitle = n.title;

                const checkbox = this.batchMode ? `<input type="checkbox" class="note-checkbox" ${this.selectedIds.has(n.id.toString()) ? 'checked' : ''}>` : '';
                const shareBtnHtml = !this.batchMode ? `<span class="note-action-share" title="分享">🔗</span><span class="note-action-delete" title="删除">×</span>` : '';
                
                el.innerHTML = `${checkbox}<div class="note-info" title="双击编辑标题">${displayTitle}</div>${shareBtnHtml}`;
                fContent.appendChild(el);
            }
        }

        list.appendChild(fragment);

        // 恢复滚动位置
        if (!isLoadMore && currentScroll > 0) {
            list.scrollTop = currentScroll;
        }

        if (filtered.length === 0 && !isLoadMore) {
            list.innerHTML = `<div style="padding:40px;text-align:center;color:var(--gray);">
                <div style="font-size:40px;margin-bottom:16px">📝</div>
                <div style="font-size:14px">没有找到笔记</div>
            </div>`;
        }

        // 再次添加加载更多按钮
        if (filtered.length > limit && !q) {
            const moreBtn = document.createElement('div');
            moreBtn.className = 'load-more-btn';
            moreBtn.style.cssText = "padding:16px;text-align:center;font-size:13px;color:var(--accent);cursor:pointer;border-top:1px solid var(--border);margin-top:10px;";
            moreBtn.textContent = `加载更多 (${filtered.length - limit})...`;
            moreBtn.onclick = (e) => {
                e.stopPropagation();
                this.render(limit + 50, true, true);
            };
            list.appendChild(moreBtn);
        }

        // 使用事件委托，只绑定一次
        if (!this._hasListEventDelegation) {
            this._setupListEventDelegation(list);
            this._hasListEventDelegation = true;
        }
    },

    // 设置列表事件委托
    _setupListEventDelegation(list) {
        // 移除旧的事件监听器
        if (this._listEventHandler) {
            list.removeEventListener('click', this._listEventHandler);
        }

        // 创建新的事件处理函数
        this._listEventHandler = (e) => {
            // 处理加载更多按钮点击
            const loadMoreBtn = e.target.closest('.load-more-btn');
            if (loadMoreBtn) {
                e.stopPropagation();
                // 提取当前已显示的笔记数量
                const currentCount = list.querySelectorAll('.note-item').length;
                this.render(currentCount + 50, true, true);
                return;
            }

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

        // 处理双击编辑标题
        this._dblClickHandler = (e) => {
            const noteInfo = e.target.closest('.note-info');
            if (!noteInfo) return;

            const noteItem = noteInfo.closest('.note-item');
            if (!noteItem) return;

            e.stopPropagation();
            const noteId = noteItem.dataset.id;
            const fullTitle = noteItem.dataset.fullTitle;
            this.editNoteTitle(noteId, fullTitle);
        };

        // 绑定事件委托
        list.addEventListener('click', this._listEventHandler);
        list.addEventListener('dblclick', this._dblClickHandler);
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
            if (n.title && n.title.includes('_')) {
                const firstPart = n.title.split('_')[0];
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
                this.showToast('批量删除失败，请检查网络连接');
                this.updateStatus('error', '删除失败');
            }
        } catch (e) {
            this.showToast('批量删除失败，请检查网络连接');
            this.updateStatus('error', '删除失败');
        }
    },

    // 编辑笔记标题
    async editNoteTitle(noteId, currentTitle) {
        // 找到对应的笔记项元素
        const noteItem = document.querySelector(`.note-item[data-id="${noteId}"]`);
        if (!noteItem) return;

        const noteInfo = noteItem.querySelector('.note-info');
        if (!noteInfo) return;

        // 保存原始内容
        const originalHTML = noteInfo.innerHTML;

        // 创建输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTitle;
        input.className = 'title-edit-input';
        input.style.cssText = `
            width: 100%;
            padding: 4px 8px;
            border: 2px solid var(--primary, #4CAF50);
            border-radius: 4px;
            font-size: inherit;
            font-family: inherit;
            background: var(--bg, #fff);
            color: var(--text, #333);
            outline: none;
            box-sizing: border-box;
        `;

        // 替换内容
        noteInfo.innerHTML = '';
        noteInfo.appendChild(input);
        input.focus();
        input.select();

        // 保存函数
        const saveTitle = async () => {
            const newTitle = input.value.trim();
            if (newTitle && newTitle !== currentTitle) {
                const idx = this.notes.findIndex(n => n.id.toString() === noteId.toString());
                if (idx !== -1) {
                    const now = Math.floor(Date.now() / 1000);
                    this.notes[idx] = {
                        ...this.notes[idx],
                        title: newTitle,
                        updatedAt: now
                    };

                    // 保存到云端
                    await this.saveToCloud(this.notes[idx]);

                    // 重新渲染左侧目录
                    this.render();
                }
            } else {
                // 恢复原始内容
                noteInfo.innerHTML = originalHTML;
            }
        };

        // 监听事件
        input.addEventListener('blur', saveTitle);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                input.value = currentTitle;
                input.blur();
            }
        });
    },

    // 批量移动
    async batchMove() {
        if (this.selectedIds.size === 0) return;
        
        const folderName = prompt("请输入目标目录名称（留空则移至根目录）：", "");
        if (folderName === null) return;
        
        const cleanFolderName = folderName.trim().replace(/_/g, '');
        const now = Math.floor(Date.now() / 1000);
        
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
                // 从标题中提取纯标题（去掉分类前缀）
                let pureTitle = n.title.includes('_') ? n.title.split('_').pop() : n.title;

                const newTitle = cleanFolderName ? `${cleanFolderName}_${pureTitle}` : pureTitle;

                updatedCount++;
                const updatedNote = { ...n, title: newTitle, updatedAt: now, isUnsynced: true };

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
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: 320px;
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; font-size: 16px; color: var(--text);">选择去重模式</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; border-radius: 4px; transition: background 0.15s;">
                    <input type="radio" name="dedup-mode" value="both" checked autocomplete="off" style="width: 16px; height: 16px; accent-color: var(--accent);">
                    <div>
                        <div style="font-weight: 500; color: var(--text);">标题和内容完全相同</div>
                        <div style="font-size: 12px; color: var(--gray);">最严格的去重，推荐使用</div>
                    </div>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; border-radius: 4px; transition: background 0.15s;">
                    <input type="radio" name="dedup-mode" value="title" autocomplete="off" style="width: 16px; height: 16px; accent-color: var(--accent);">
                    <div>
                        <div style="font-weight: 500; color: var(--text);">仅标题相同</div>
                        <div style="font-size: 12px; color: var(--gray);">内容可能不同，谨慎使用</div>
                    </div>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; border-radius: 4px; transition: background 0.15s;">
                    <input type="radio" name="dedup-mode" value="content" autocomplete="off" style="width: 16px; height: 16px; accent-color: var(--accent);">
                    <div>
                        <div style="font-weight: 500; color: var(--text);">仅内容相同</div>
                        <div style="font-size: 12px; color: var(--gray);">标题可能不同，谨慎使用</div>
                    </div>
                </label>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 20px; justify-content: flex-end;">
                <button id="dedup-cancel" style="padding: 8px 16px; border: 1px solid var(--border); background: var(--side); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 13px;">取消</button>
                <button id="dedup-confirm" style="padding: 8px 16px; border: none; background: var(--accent); color: white; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;">开始检查</button>
            </div>
        `;

        document.body.appendChild(dialog);

        // 添加悬停效果
        dialog.querySelectorAll('label').forEach(label => {
            label.onmouseenter = () => label.style.background = 'var(--side)';
            label.onmouseleave = () => label.style.background = 'transparent';
        });

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
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        `;
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

    // 设置标记起始位置
    setMarkerStart() {
        if (!this.editor) {
            this.updateStatus('error', '请先打开笔记');
            return;
        }

        try {
            // 清除之前的标记高亮
            this.clearMarkerHighlights();

            // 获取当前光标位置
            const cursor = this.editor.getCursor();
            if (cursor) {
                this.markerStart = { ...cursor };
                this.markerActive = true;

                // 如果有之前的结束标记，清除它
                if (this.markerEnd) {
                    this.markerEnd = null;
                }

                // 显示标记信息
                this.updateStatus('success', `📍 标记起: 行 ${cursor.line + 1}, 列 ${cursor.ch + 1}`);

                // 如果已经有标记结束位置（理论上不会，但保留逻辑），则直接选择区域
                if (this.markerEnd) {
                    this.selectMarkerRange();
                }

                // 高亮显示标记起始行
                this.highlightMarkerLine(cursor.line, 'start');

                // 更新按钮状态
                this.updateMarkerButtonState('start');
            }
        } catch (error) {
            console.error('设置标记起始位置失败:', error);
            this.updateStatus('error', '设置标记起始位置失败');
        }
    },

    // 设置标记结束位置
    setMarkerEnd() {
        if (!this.editor) {
            this.updateStatus('error', '请先打开笔记');
            return;
        }

        try {
            // 获取当前光标位置
            const cursor = this.editor.getCursor();
            if (cursor) {
                this.markerEnd = { ...cursor };

                // 如果有标记起始位置，则选择区域
                if (this.markerStart) {
                    // 显示标记信息
                    this.updateStatus('success', `🏁 标记终: 行 ${cursor.line + 1}, 列 ${cursor.ch + 1}`);
                    this.selectMarkerRange();

                    // 高亮显示标记结束行
                    this.highlightMarkerLine(cursor.line, 'end');

                    // 更新按钮状态
                    this.updateMarkerButtonState('end');
                } else {
                    this.updateStatus('warning', '⚠️ 请先设置标记起始位置');
                    this.markerEnd = null;
                }
            }
        } catch (error) {
            console.error('设置标记结束位置失败:', error);
            this.updateStatus('error', '设置标记结束位置失败');
        }
    },

    // 选择标记区域
    selectMarkerRange() {
        if (!this.markerStart || !this.markerEnd || !this.editor) {
            return;
        }

        try {
            // 先使用 CodeMirror 的原生 setSelection 方法
            // 检查编辑器是否有原生方法
            if (this.editor._editor && this.editor._editor.setSelection) {
                const from = {
                    line: this.markerStart.line,
                    ch: this.markerStart.ch
                };
                const to = {
                    line: this.markerEnd.line,
                    ch: this.markerEnd.ch
                };

                // 使用原生 CodeMirror setSelection
                this.editor._editor.setSelection(from, to);

                // 滚动到选择区域
                this.editor._editor.scrollIntoView(from, 100);

                // 获取选中的文本
                const selectedText = this.editor.getSelection();
                const textLength = selectedText ? selectedText.length : 0;

                // 显示选择信息
                const lineCount = Math.abs(to.line - from.line) + 1;
                this.updateStatus('success', `已选择 ${lineCount} 行, ${textLength} 个字符`);

                // 高亮显示标记区域
                this.highlightMarkerRange(from, to);
            } else {
                // 降级方案: 使用适配器的 setSelection (需要索引)
                const content = this.editor.getValue();
                const lines = content.split('\n');

                // 计算 from 的索引
                let fromIndex = 0;
                for (let i = 0; i < this.markerStart.line; i++) {
                    fromIndex += (lines[i] || '').length + 1; // +1 是换行符
                }
                fromIndex += this.markerStart.ch;

                // 计算 to 的索引
                let toIndex = 0;
                for (let i = 0; i < this.markerEnd.line; i++) {
                    toIndex += (lines[i] || '').length + 1;
                }
                toIndex += this.markerEnd.ch;

                // 使用适配器的 setSelection
                this.editor.setSelection(fromIndex, toIndex);

                // 显示选择信息
                const selectedText = this.editor.getSelection();
                const textLength = selectedText ? selectedText.length : 0;
                const lineCount = Math.abs(this.markerEnd.line - this.markerStart.line) + 1;
                this.updateStatus('success', `已选择 ${lineCount} 行, ${textLength} 个字符`);
            }
        } catch (error) {
            console.error('选择标记区域失败:', error);
            this.updateStatus('error', '选择标记区域失败');
        }
    },

    // 高亮显示标记行
    highlightMarkerLine(line, type) {
        if (!this.editor) return;

        try {
            // 添加临时标记类
            this.editor.addLineClass(line, 'background', `marker-${type}`);

            // 清除之前的定时器（如果存在）
            if (this.markerTimeouts[`line-${line}-${type}`]) {
                clearTimeout(this.markerTimeouts[`line-${line}-${type}`]);
            }

            // 标记起始行高亮持续显示（不自动清除）
            // 标记结束行高亮持续显示（不自动清除）
        } catch (error) {
            console.error('高亮标记行失败:', error);
        }
    },

    // 高亮显示标记区域
    highlightMarkerRange(from, to) {
        if (!this.editor) return;

        try {
            // 清除之前的区域高亮
            const existingMarks = this.editor.getAllMarks ? this.editor.getAllMarks() : [];
            existingMarks.forEach(mark => {
                if (mark.className === 'marker-highlight') {
                    mark.clear();
                }
            });

            // 清除之前的定时器
            if (this.markerTimeouts['range']) {
                clearTimeout(this.markerTimeouts['range']);
            }

            // 使用编辑器的选择标记功能
            const textMark = this.editor.markText(from, to, {
                className: 'marker-highlight',
                clearOnEnter: false
            });

            // 保存标记引用,不清除区域高亮(让用户手动清除或操作时清除)
            this._currentRangeMark = textMark;
        } catch (error) {
            console.error('高亮标记区域失败:', error);
        }
    },

    // 清除标记高亮
    clearMarkerHighlights() {
        if (!this.editor) return;

        try {
            // 清除行高亮
            if (this.markerStart) {
                this.editor.removeLineClass(this.markerStart.line, 'background', 'marker-start');
            }
            if (this.markerEnd) {
                this.editor.removeLineClass(this.markerEnd.line, 'background', 'marker-end');
            }

            // 清除区域高亮
            const marks = this.editor.getAllMarks ? this.editor.getAllMarks() : [];
            marks.forEach(mark => {
                if (mark.className === 'marker-highlight') {
                    mark.clear();
                }
            });
        } catch (error) {
            console.error('清除标记高亮失败:', error);
        }
    },

    // 更新标记按钮状态
    updateMarkerButtonState(type) {
        const startBtn = document.querySelector('button[onclick="ui.setMarkerStart()"]');
        const endBtn = document.querySelector('button[onclick="ui.setMarkerEnd()"]');

        if (!startBtn || !endBtn) return;

        // 重置按钮样式
        startBtn.style.background = '';
        startBtn.style.borderColor = '';
        endBtn.style.background = '';
        endBtn.style.borderColor = '';

        // 根据状态更新
        if (type === 'start' || (this.markerStart && !this.markerEnd)) {
            startBtn.style.background = 'rgba(34, 197, 94, 0.2)';
            startBtn.style.borderColor = '#22c55e';
        } else if (type === 'end' || (this.markerStart && this.markerEnd)) {
            endBtn.style.background = 'rgba(239, 68, 68, 0.2)';
            endBtn.style.borderColor = '#ef4444';
            startBtn.style.background = 'rgba(34, 197, 94, 0.2)';
            startBtn.style.borderColor = '#22c55e';
        }
    },

    // 清除标记
    clearMarker() {
        // 清除标记数据
        this.markerStart = null;
        this.markerEnd = null;
        this.markerActive = false;

        // 清除所有高亮
        this.clearMarkerHighlights();

        // 清除定时器
        Object.values(this.markerTimeouts).forEach(timer => clearTimeout(timer));
        this.markerTimeouts = {};

        // 更新状态和按钮
        this.updateStatus('idle', '标记已清除');
        this.updateMarkerButtonState('clear');
    },

    // 复制标记区域
    async copyMarkerRange() {
        if (!this.markerStart || !this.markerEnd || !this.editor) {
            this.updateStatus('warning', '请先设置标记区域');
            return;
        }

        try {
            // 选择标记区域
            this.selectMarkerRange();

            // 获取选中的文本
            const selectedText = this.editor.getSelection();
            if (!selectedText) {
                this.updateStatus('warning', '没有选中的文本');
                return;
            }

            // 使用现代 Clipboard API 复制
            try {
                await navigator.clipboard.writeText(selectedText);
                this.updateStatus('success', `已复制 ${selectedText.length} 个字符`);
            } catch (clipboardError) {
                // 降级方案: 使用 execCommand
                try {
                    document.execCommand('copy');
                    this.updateStatus('success', `已复制 ${selectedText.length} 个字符`);
                } catch (execError) {
                    this.updateStatus('error', '复制失败,请手动复制');
                }
            }
        } catch (error) {
            console.error('复制标记区域失败:', error);
            this.updateStatus('error', '复制标记区域失败');
        }
    },

    // 剪切标记区域
    cutMarkerRange() {
        if (!this.markerStart || !this.markerEnd || !this.editor) {
            this.updateStatus('warning', '请先设置标记区域');
            return;
        }

        try {
            // 选择标记区域
            this.selectMarkerRange();

            // 剪切选中的文本
            this.execCommand('cut');
            this.clearMarker();
            this.updateStatus('success', '已剪切标记区域');
        } catch (error) {
            this.updateStatus('error', '剪切标记区域失败');
        }
    },

    // 删除标记区域
    deleteMarkerRange() {
        if (!this.markerStart || !this.markerEnd || !this.editor) {
            this.updateStatus('warning', '请先设置标记区域');
            return;
        }

        try {
            // 选择标记区域
            this.selectMarkerRange();

            // 删除选中的文本
            this.editor.replaceSelection('');
            this.clearMarker();
            this.updateStatus('success', '已删除标记区域');
        } catch (error) {
            this.updateStatus('error', '删除标记区域失败');
        }
    },

    // 执行编辑器命令
    execCommand(command) {
        if (!this.editor) return;

        try {
            // CodeMirror方式
            if (this.editor.execCommand) {
                this.editor.execCommand(command);
            }
            // 浏览器原生方式
            else {
                document.execCommand(command);
            }
        } catch (error) {
            console.error('执行命令失败:', error);
        }
    },

    // 设置标记快捷键
    setupMarkerShortcuts() {
        if (!this.editor) return;

        try {
            // 获取编辑器的DOM元素
            const editorElement = this.editor.getWrapperElement();
            if (!editorElement) return;

            // 移除旧的监听器（如果存在）
            if (this._markerKeyHandler) {
                editorElement.removeEventListener('keydown', this._markerKeyHandler);
            }

            // 创建键盘事件处理器
            this._markerKeyHandler = (e) => {
                // F1 显示快捷键
                if (e.key === 'F1') {
                    e.preventDefault();
                    this.showShortcuts();
                    return;
                }

                // 检测是否是 Mac 系统
                const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                const modifierKey = isMac ? e.metaKey : e.ctrlKey;

                // Ctrl+Z / Cmd+Z 撤销
                if (modifierKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    this.undo();
                    return;
                }

                // Ctrl+Y / Cmd+Shift+Z 重做（Windows用Y，Mac用Shift+Z）
                if (modifierKey && (e.key.toLowerCase() === 'y' || (isMac && e.shiftKey && e.key.toLowerCase() === 'z'))) {
                    e.preventDefault();
                    this.redo();
                    return;
                }

                // Ctrl+B / Cmd+B 切换侧边栏
                if (modifierKey && e.key.toLowerCase() === 'b') {
                    e.preventDefault();
                    this.toggleSidebar();
                    return;
                }

                // Alt+[ 设置标记起始位置（避免与输入法冲突）
                if (e.altKey && e.key === '[') {
                    e.preventDefault();
                    this.setMarkerStart();
                    return;
                }

                // Alt+] 设置标记结束位置（避免与输入法冲突）
                if (e.altKey && e.key === ']') {
                    e.preventDefault();
                    this.setMarkerEnd();
                    return;
                }

                // Cmd/Ctrl+Shift+C 复制标记区域
                if (modifierKey && e.shiftKey && e.key === 'C') {
                    e.preventDefault();
                    this.copyMarkerRange();
                    return;
                }

                // Cmd/Ctrl+Shift+X 剪切标记区域
                if (modifierKey && e.shiftKey && e.key === 'X') {
                    e.preventDefault();
                    this.cutMarkerRange();
                    return;
                }

                // Cmd/Ctrl+Shift+D 删除标记区域
                if (modifierKey && e.shiftKey && e.key === 'D') {
                    e.preventDefault();
                    this.deleteMarkerRange();
                    return;
                }

                // Escape 清除标记
                if (e.key === 'Escape') {
                    this.clearMarker();
                    return;
                }
            };

            // 添加键盘监听器
            editorElement.addEventListener('keydown', this._markerKeyHandler);

        } catch (error) {
            console.error('设置标记快捷键失败:', error);
        }
    },

    // 清除标记快捷键
    cleanupMarkerShortcuts() {
        if (!this.editor || !this._markerKeyHandler) return;

        try {
            const editorElement = this.editor.getWrapperElement();
            if (editorElement) {
                editorElement.removeEventListener('keydown', this._markerKeyHandler);
            }
            this._markerKeyHandler = null;
        } catch (error) {
            console.error('清除标记快捷键失败:', error);
        }
    },

    // 显示快捷键提示
    showShortcuts() {
        const modal = document.getElementById('shortcuts-modal');
        if (modal) {
            modal.style.display = 'flex';
        }
    },

    // 隐藏快捷键提示
    hideShortcuts() {
        const modal = document.getElementById('shortcuts-modal');
        if (modal) {
            modal.style.display = 'none';
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

        // 格式化大小工具
        const formatSize = (mb) => {
            const bytes = parseFloat(mb) * 1024 * 1024;
            if (bytes === 0) return '0B';
            if (bytes < 1024) return bytes.toFixed(0) + 'B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
            return parseFloat(mb).toFixed(2) + 'MB';
        };

        try {
            const res = await fetch('/api/user-info', { cache: 'no-store' });
            if (!res.ok) throw new Error('Failed to load user info');
            const data = await res.json();

            // 更新用户显示
            const userDisplay = document.getElementById('user-display');
            if (userDisplay) {
                userDisplay.textContent = `用户: ${data.username}`;
            }

            // 保存用户名到localStorage供WebSocket使用
            if (data.username) {
                localStorage.setItem('z7note_username', data.username);
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

            // 更新数据配额 (包含 笔记/联系人/日历/待办)
            const noteUsageText = document.getElementById('note-usage-text');
            const noteBar = document.getElementById('note-bar');
            if (noteUsageText && noteBar && data.noteLimit) {
                const noteUsageMB = parseFloat(data.noteUsage || 0);
                const notePercent = Math.min((noteUsageMB / data.noteLimit) * 100, 100);
                
                // 设置显示文本为格式化后的实际占用/限额
                noteUsageText.textContent = `${formatSize(noteUsageMB)}/${Math.round(data.noteLimit)}MB`;
                
                // 设置父级容器显示详细数量提示
                const noteContainer = noteUsageText.parentElement;
                if (noteContainer) {
                    noteContainer.title = `笔记: ${data.noteCount || 0} | 联系人: ${data.contactCount || 0} | 日历: ${data.eventCount || 0} | 待办: ${data.todoCount || 0}`;
                    // 修改标签文本 (如果有)
                    const label = noteContainer.previousSibling;
                    if (label && label.nodeType === 3 && label.textContent.includes('笔记:')) {
                        label.textContent = label.textContent.replace('笔记:', '数据:');
                    }
                }
                
                noteBar.style.width = `${notePercent}%`;
            }

            // 更新附件配额
            const fileUsageText = document.getElementById('file-usage-text');
            const fileBar = document.getElementById('file-bar');
            if (fileUsageText && fileBar && data.fileLimit) {
                const fileUsageMB = parseFloat(data.fileUsage || 0);
                const filePercent = Math.min((fileUsageMB / data.fileLimit) * 100, 100);
                
                fileUsageText.textContent = `${formatSize(fileUsageMB)}/${Math.round(data.fileLimit)}MB`;
                fileBar.style.width = `${filePercent}%`;
            }

            // 更新附件预览配置
            if (data.attachmentPreviewConfig) {
                this.attachmentPreviewConfig = {
                    ...this.attachmentPreviewConfig,
                    ...data.attachmentPreviewConfig
                };
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
        const shouldLogout = confirm('确定要退出登录吗？');
        if (!shouldLogout) return;

        const clearCache = confirm('是否同时清除浏览器缓存？\n\n这将清除：\n- 本地存储数据（用户信息、设置等）\n- 会话存储数据\n- IndexedDB 数据库\n- Service Worker 缓存\n- Cache API 缓存\n\n建议定期清除缓存以保护隐私。');

        try {
            // 断开 WebSocket 连接
            if (window.wsManager && window.wsManager.disconnect) {
                window.wsManager.disconnect();
            }

            await fetch('/api/logout', { method: 'POST' });

            // 如果用户选择清除缓存
            if (clearCache) {
                console.log('[Logout] 清除浏览器缓存...');

                // 清除本地存储数据
                localStorage.clear();
                console.log('[Logout] localStorage 已清除');

                // 清除会话存储数据
                sessionStorage.clear();
                console.log('[Logout] sessionStorage 已清除');

                // 清除可能的 IndexedDB 数据
                if (window.indexedDB) {
                    const databases = await indexedDB.databases();
                    if (databases.length > 0) {
                        console.log('[Logout] 清除 IndexedDB 数据库:', databases.map(d => d.name).filter(Boolean));
                        for (const db of databases) {
                            if (db.name) {
                                indexedDB.deleteDatabase(db.name);
                            }
                        }
                    }
                }

                // 清除 Service Worker 缓存
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    if (registrations.length > 0) {
                        console.log('[Logout] 清除 Service Worker，数量:', registrations.length);
                        for (const registration of registrations) {
                            await registration.unregister();
                        }
                    }
                }

                // 清除 Cache API 缓存
                if ('caches' in window) {
                    const cacheNames = await caches.keys();
                    if (cacheNames.length > 0) {
                        console.log('[Logout] 清除 Cache API，缓存列表:', cacheNames);
                        for (const cacheName of cacheNames) {
                            await caches.delete(cacheName);
                        }
                    }
                }

                console.log('[Logout] 浏览器缓存清除完成');
            } else {
                // 即使用户不选择清除缓存，也要清除关键的敏感数据
                console.log('[Logout] 清除敏感数据');
                localStorage.removeItem('z7note_username');
                localStorage.removeItem('username');
                localStorage.removeItem('p-theme');
                localStorage.removeItem('theme');
            }

            // 延迟跳转，让日志有时间输出
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 500);
        } catch (e) {
            console.error('[Logout] 退出失败:', e);

            // 即使服务器请求失败，也要断开 WebSocket 连接
            if (window.wsManager && window.wsManager.disconnect) {
                window.wsManager.disconnect();
            }

            // 清除关键的敏感数据
            localStorage.removeItem('z7note_username');
            localStorage.removeItem('username');
            localStorage.removeItem('p-theme');
            localStorage.removeItem('theme');

            // 如果用户选择清除缓存
            if (clearCache) {
                console.log('[Logout] 清除全部缓存（错误处理）');
                localStorage.clear();
                sessionStorage.clear();
            }

            setTimeout(() => {
                window.location.href = '/login.html';
            }, 500);
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
                            <div style="font-size:11px;color:var(--gray);margin-top:2px;">${new Date(note.updatedAt > 10000000000 ? note.updatedAt : note.updatedAt * 1000).toLocaleString('zh-CN')}</div>
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

    // 显示邮箱模态框内部反馈
    _showEmailModalFeedback(msg, isSuccess = false) {
        const feedbackEl = document.getElementById('modal-email-feedback');
        if (!feedbackEl) return;
        feedbackEl.textContent = msg;
        feedbackEl.style.display = 'block';
        feedbackEl.style.color = isSuccess ? 'var(--green)' : 'var(--red)';
        feedbackEl.style.background = isSuccess ? 'rgba(40, 167, 69, 0.1)' : 'rgba(220, 53, 69, 0.1)';
    },

    // 打开邮箱绑定模态框
    promptBindEmail() {
        const modal = document.getElementById('email-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.getElementById('modal-email-input').value = '';
            document.getElementById('modal-code-input').value = '';
            const feedbackEl = document.getElementById('modal-email-feedback');
            if (feedbackEl) feedbackEl.style.display = 'none';
            const btn = document.getElementById('modal-send-btn');
            btn.textContent = '发送验证码';
            btn.disabled = false;
            setTimeout(() => document.getElementById('modal-email-input')?.focus(), 0);
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
            this._showEmailModalFeedback('请输入正确的邮箱地址', false);
            return;
        }

        const btn = document.getElementById('modal-send-btn');
        btn.disabled = true;
        this._showEmailModalFeedback('正在发送...', true);

        try {
            const res = await fetch('/api/send-bind-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            // 先检查响应类型
            const contentType = res.headers.get('content-type');
            let data = {};
            if (contentType && contentType.includes('application/json')) {
                data = await res.json();
            }

            if (res.ok) {
                this._showEmailModalFeedback('验证码已发送至您的邮箱', true);
                setTimeout(() => document.getElementById('modal-code-input')?.focus(), 0);

                let count = 60;
                btn.textContent = `${count}s`;
                const timer = setInterval(() => {
                    count--;
                    if (count <= 0) {
                        clearInterval(timer);
                        btn.disabled = false;
                        btn.textContent = '发送验证码';
                    } else {
                        btn.textContent = `${count}s`;
                    }
                }, 1000);
            } else {
                // 处理会话过期的情况
                if (data.error && data.error.includes('会话已过期')) {
                    this._showEmailModalFeedback('会话已过期，请重新登录', false);
                    setTimeout(() => {
                        window.location.href = '/login.html';
                    }, 1500);
                    return;
                }
                
                this._showEmailModalFeedback(data.error || '发送失败', false);
                btn.disabled = false;
            }
        } catch (e) {
            console.error('[SendCode] 网络连接或解析异常:', e);
            this._showEmailModalFeedback('发送失败，请检查网络', false);
            btn.disabled = false;
        }
    },

    // 验证并绑定邮箱
    async modalVerifyCode() {
        // 防止重复点击
        const btn = document.getElementById('modal-verify-btn');
        if (btn.disabled) {
            return;
        }

        const email = document.getElementById('modal-email-input').value.trim();
        const code = document.getElementById('modal-code-input').value.trim();

        if (!email || !code) {
            this._showEmailModalFeedback('请填写邮箱和验证码', false);
            return;
        }

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '验证中...';
        this._showEmailModalFeedback('正在验证验证码...', true);

        let shouldKeepDisabled = false;

        try {
            const res = await fetch('/api/verify-bind-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, token: code })
            });

            // 先检查响应类型
            let data = {};
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                try {
                    data = await res.json();
                } catch (e) {
                    console.error('[VerifyEmail] JSON 解析失败:', e);
                }
            }

            if (res.ok) {
                this._showEmailModalFeedback('绑定成功！正在刷新...', true);
                shouldKeepDisabled = true;
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                // 处理 502 等非业务错误
                if (res.status === 502) {
                    this._showEmailModalFeedback('服务器响应异常 (502)，请稍后重试', false);
                    console.error(`[VerifyEmail] 服务器返回 502 错误`);
                } else if (res.status === 401 || (data.error && data.error.includes('会话已过期'))) {
                    // 处理会话过期的情况
                    this._showEmailModalFeedback('会话已过期，请重新登录', false);
                    shouldKeepDisabled = true;
                    setTimeout(() => {
                        window.location.href = '/login.html';
                    }, 1500);
                } else if (res.status === 400) {
                    // 处理 400 错误（验证码错误等）
                    this._showEmailModalFeedback(data.error || '验证码错误', false);
                } else {
                    this._showEmailModalFeedback(data.error || `验证失败 (${res.status})`, false);
                }
            }
        } catch (e) {
            console.error('[VerifyEmail] 网络连接或解析异常:', e);
            this._showEmailModalFeedback('无法连接到服务器，请检查网络', false);
        } finally {
            // 只有在不需要保持禁用状态时才重新启用按钮
            if (!shouldKeepDisabled) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    },

    // 打开改密模态框
    showChangePasswordModal() {
        const modal = document.getElementById('change-password-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.getElementById('old-password-input').value = '';
            document.getElementById('new-password-input').value = '';
            document.getElementById('confirm-password-input').value = '';
            document.getElementById('change-password-error').style.display = 'none';
            document.getElementById('change-password-btn').disabled = false;
            document.getElementById('change-password-btn').textContent = '确认修改';
            setTimeout(() => document.getElementById('old-password-input')?.focus(), 0);

            // 设置隐藏的用户名字段
            const userDisplay = document.getElementById('user-display');
            const usernameInput = document.getElementById('username-input');
            if (userDisplay && usernameInput) {
                const text = userDisplay.textContent;
                const username = text.replace('用户: ', '');
                usernameInput.value = username;
            }
        }
    },

    // 关闭改密模态框
    closeChangePasswordModal() {
        const modal = document.getElementById('change-password-modal');
        if (modal) modal.style.display = 'none';
    },

    // 修改密码
    async changePassword() {
        const oldPass = document.getElementById('old-password-input').value.trim();
        const newPass = document.getElementById('new-password-input').value.trim();
        const confirmPass = document.getElementById('confirm-password-input').value.trim();
        const errorEl = document.getElementById('change-password-error');
        const btn = document.getElementById('change-password-btn');
        
        // 验证输入
        if (!oldPass || !newPass || !confirmPass) {
            errorEl.textContent = '请填写所有字段';
            errorEl.style.display = 'block';
            return;
        }
        
        if (newPass.length < 6) {
            errorEl.textContent = '新密码至少需要6个字符';
            errorEl.style.display = 'block';
            return;
        }
        
        if (newPass !== confirmPass) {
            errorEl.textContent = '两次输入的新密码不一致';
            errorEl.style.display = 'block';
            return;
        }
        
        errorEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = '修改中...';
        
        try {
            const res = await fetch('/api/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ oldPass, newPass })
            });
            
            if (res.ok) {
                this.showToast('密码修改成功');
                this.closeChangePasswordModal();
            } else {
                const data = await res.json();
                errorEl.textContent = data.error || '修改失败';
                errorEl.style.display = 'block';
                btn.disabled = false;
                btn.textContent = '确认修改';
            }
        } catch (e) {
            errorEl.textContent = '修改失败，请稍后重试';
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '确认修改';
        }
    },
    // 显示 2FA 设置模态框
    async show2FASettings() {
        const modal = document.getElementById('2fa-modal');
        const content = document.getElementById('2fa-content');

        if (!modal || !content) return;

        modal.style.display = 'flex';
        content.innerHTML = '<div class="twofa-panel"><div class="twofa-card"><div class="twofa-feedback">加载中...</div></div></div>';

        try {
            const res = await fetch('/api/2fa/status');
            if (res.ok) {
                const data = await res.json();
                this.render2FAContent(data);
            } else if (res.status === 404) {
                content.innerHTML = this.render2FAStateMessage('⚠️', '功能未实现', '两步验证功能需要后端支持，请联系管理员启用此功能');
            } else {
                content.innerHTML = this.render2FAStateMessage('⚠️', '加载失败', '暂时无法获取两步验证状态，请稍后再试。');
            }
        } catch (e) {
            console.error('加载 2FA 状态失败:', e);
            content.innerHTML = this.render2FAStateMessage('⚠️', '网络错误', '无法连接到服务器，请检查网络连接。');
        }
    },

    render2FAStateMessage(icon, title, message, buttonLabel = '关闭', buttonAction = 'window.ui.close2FAModal()') {
        return `
            <div class="twofa-panel">
                <div class="twofa-header">
                    <div class="twofa-icon">${icon}</div>
                    <div class="twofa-title">${title}</div>
                    <div class="twofa-subtitle">${message}</div>
                </div>
                <div class="twofa-actions">
                    <button class="btn btn-primary" onclick="${buttonAction}">${buttonLabel}</button>
                </div>
            </div>
        `;
    },

    escapeHtml(value = '') {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    render2FABackupCodes(codes = [], { warning = '', emptyText = '无', primaryAction = '', primaryLabel = '', secondaryAction = '', secondaryLabel = '' } = {}) {
        const hasCodes = Array.isArray(codes) && codes.length > 0;
        const codesHtml = hasCodes
            ? `<div class="twofa-backup-grid">${codes.map(code => `<div class="twofa-backup-code">${this.escapeHtml(code)}</div>`).join('')}</div>`
            : `<div class="twofa-feedback">${emptyText}</div>`;

        const actions = [
            primaryAction && primaryLabel ? `<button class="btn btn-secondary" onclick="${primaryAction}">${primaryLabel}</button>` : '',
            secondaryAction && secondaryLabel ? `<button class="btn btn-primary" onclick="${secondaryAction}">${secondaryLabel}</button>` : ''
        ].filter(Boolean).join('');

        return `
            <div class="twofa-card">
                <div class="twofa-card-title">备用代码${hasCodes ? `（${codes.length}）` : ''}</div>
                ${warning ? `<div class="twofa-feedback twofa-warning">${warning}</div>` : ''}
                ${codesHtml}
                ${actions ? `<div class="twofa-actions">${actions}</div>` : ''}
            </div>
        `;
    },

    // 渲染 2FA 内容
    render2FAContent(data) {
        const content = document.getElementById('2fa-content');
        if (!content) return;

        if (data.enabled) {
            const backupCodes = Array.isArray(data.backupCodes) ? data.backupCodes : [];
            this.currentBackupCodes = backupCodes;
            content.innerHTML = `
                <div class="twofa-panel">
                    <div class="twofa-header">
                        <div class="twofa-icon">✅</div>
                        <div class="twofa-title">两步验证已启用</div>
                        <div class="twofa-subtitle">账户已受保护，可使用动态验证码或备用代码登录。</div>
                    </div>
                    ${this.render2FABackupCodes(backupCodes, {
                        emptyText: '当前没有可用备用代码。',
                        primaryAction: 'window.ui.copyBackupCodes()',
                        primaryLabel: '复制代码',
                        secondaryAction: 'window.ui.refreshBackupCodes()',
                        secondaryLabel: backupCodes.length > 0 ? '重新生成' : '生成备用代码'
                    })}
                    <div class="twofa-actions">
                        <button class="btn btn-secondary" onclick="window.ui.close2FAModal()">取消</button>
                        <button class="btn btn-danger" onclick="window.ui.disable2FA()">停用两步验证</button>
                    </div>
                </div>
            `;
        } else {
            content.innerHTML = `
                <div class="twofa-panel">
                    <div class="twofa-header">
                        <div class="twofa-icon">🔐</div>
                        <div class="twofa-title">启用两步验证</div>
                        <div class="twofa-subtitle">使用验证器应用扫描二维码，或复制完整 otpauth 连接手动导入。</div>
                    </div>
                    <div class="twofa-card">
                        <div class="twofa-card-title">验证器配置</div>
                        <div id="2fa-qrcode" class="twofa-qr" style="display:flex;justify-content:center;align-items:center;width:100%;min-height:144px;margin:0 auto;">
                            <div class="twofa-feedback" style="width:100%;text-align:center;">加载中...</div>
                        </div>
                    </div>
                    <div class="twofa-card">
                        <div class="twofa-card-title">密钥</div>
                        <div id="2fa-secret" class="twofa-secret">-</div>
                    </div>
                    <div class="twofa-card">
                        <div class="twofa-card-title">完整连接</div>
                        <div style="width:100%;display:block;">
                            <textarea id="2fa-uri" class="twofa-uri-input" readonly spellcheck="false" style="display:block;width:100%;min-width:100%;max-width:100%;">-</textarea>
                        </div>
                        <div class="twofa-actions">
                            <button class="btn btn-secondary" type="button" onclick="window.ui.copy2FAUri()">复制连接</button>
                        </div>
                    </div>
                    <div class="twofa-card">
                        <div class="twofa-card-title">验证码</div>
                        <input type="text" id="2fa-code" class="twofa-code-input" placeholder="输入 6 位验证码" maxlength="6" autocomplete="one-time-code" inputmode="numeric" data-bwignore="true" style="display:block;width:100%;box-sizing:border-box;">
                    </div>
                    <div class="twofa-actions">
                        <button class="btn btn-secondary" onclick="window.ui.close2FAModal()">取消</button>
                        <button class="btn btn-primary" onclick="window.ui.enable2FA()">启用两步验证</button>
                    </div>
                </div>
            `;

            this.generate2FAQRCode();
        }
    },

    // 生成 2FA QR 码
    async generate2FAQRCode() {
        try {
            const res = await fetch('/api/2fa/setup', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();

                const qrContainer = document.getElementById('2fa-qrcode');
                const secretSpan = document.getElementById('2fa-secret');
                const uriEl = document.getElementById('2fa-uri');

                if (qrContainer && data.qrCode) {
                    qrContainer.innerHTML = `<img src="${data.qrCode}" alt="2FA QR Code" style="display:block;width:132px;height:132px;margin:0 auto;">`;
                }

                if (secretSpan && data.secret) {
                    secretSpan.textContent = data.secret;
                }

                if (uriEl && data.otpAuthUrl) {
                    uriEl.textContent = data.otpAuthUrl;
                }

                setTimeout(() => document.getElementById('2fa-code')?.focus(), 0);
            }
        } catch (e) {
            console.error('生成 2FA QR 码失败:', e);
        }
    },

    async copy2FAUri() {
        const uri = document.getElementById('2fa-uri')?.value?.trim() || document.getElementById('2fa-uri')?.textContent?.trim();
        if (!uri || uri === '-') {
            this.showToast('暂无可复制的连接', false);
            return;
        }

        try {
            await navigator.clipboard.writeText(uri);
            this.showToast('完整连接已复制');
        } catch (e) {
            console.error('复制 2FA 连接失败:', e);
            this.showToast('复制失败', false);
        }
    },

    // 启用 2FA
    async enable2FA() {
        const code = document.getElementById('2fa-code')?.value.trim();
        
        if (!code || code.length !== 6) {
            this.showToast('请输入6位验证码', false);
            return;
        }
        
        try {
            const res = await fetch('/api/2fa/enable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: code })
            });
            
            if (res.ok) {
                const data = await res.json();
                this.showToast('两步验证已启用');
                
                // 先显示成功状态和备用代码
                const content = document.getElementById('2fa-content');
                if (content) {
                    const backupCodes = Array.isArray(data.backupCodes) ? data.backupCodes : [];
                    this.currentBackupCodes = backupCodes;
                    content.innerHTML = `
                        <div class="twofa-panel">
                            <div class="twofa-header">
                                <div class="twofa-icon">✅</div>
                                <div class="twofa-title">两步验证已成功启用</div>
                                <div class="twofa-subtitle">您的账户现在已受保护，请立即保存备用代码。</div>
                            </div>
                            ${this.render2FABackupCodes(backupCodes, {
                                warning: '请妥善保存以下备用代码，每个代码只能使用一次。',
                                primaryAction: 'window.ui.copyBackupCodes()',
                                primaryLabel: '复制备用代码'
                            })}
                            <div class="twofa-actions">
                                <button class="btn btn-primary" onclick="window.ui.close2FAModal()">确定</button>
                            </div>
                        </div>
                    `;
                }
                
                // 更新状态显示
                this.update2FAStatus(true);
            } else {
                const data = await res.json();
                this.showToast(data.message || data.error || '启用失败', false);
            }
        } catch (e) {
            console.error('启用 2FA 失败:', e);
            this.showToast('启用失败', false);
        }
    },
    
    // 复制备用代码
    async copyBackupCodes() {
        if (this.currentBackupCodes && this.currentBackupCodes.length > 0) {
            try {
                await navigator.clipboard.writeText(this.currentBackupCodes.join('\n'));
                this.showToast('备用代码已复制到剪贴板');
            } catch (e) {
                console.error('复制失败:', e);
                this.showToast('复制失败', false);
            }
        }
    },
    
    // 禁用 2FA
    async disable2FA() {
        if (!confirm('确定要禁用两步验证吗？这将降低账户安全性。')) {
            return;
        }
        
        try {
            const res = await fetch('/api/2fa/disable', {
                method: 'POST'
            });
            
            if (res.ok) {
                this.showToast('两步验证已禁用');
                this.close2FAModal();
                this.update2FAStatus(false);
            } else {
                const data = await res.json();
                this.showToast(data.error || '禁用失败', false);
            }
        } catch (e) {
            console.error('禁用 2FA 失败:', e);
            this.showToast('禁用失败', false);
        }
    },
    
    // 重新生成备用代码
    async refreshBackupCodes() {
        if (!confirm('确定要重新生成备用代码吗？这将使所有旧的备用代码失效。')) {
            return;
        }
        
        try {
            const res = await fetch('/api/2fa/refresh-backup-codes', {
                method: 'POST'
            });
            
            if (res.ok) {
                const data = await res.json();
                this.currentBackupCodes = data.backupCodes;
                
                // 显示新生成的备用代码
                const content = document.getElementById('2fa-content');
                if (content) {
                    content.innerHTML = `
                        <div class="twofa-panel">
                            <div class="twofa-header">
                                <div class="twofa-icon">✅</div>
                                <div class="twofa-title">备用代码已重新生成</div>
                                <div class="twofa-subtitle">旧代码已失效，请保存新的备用代码。</div>
                            </div>
                            ${this.render2FABackupCodes(data.backupCodes, {
                                primaryAction: 'window.ui.copyBackupCodes()',
                                primaryLabel: '复制备用代码'
                            })}
                            <div class="twofa-actions">
                                <button class="btn btn-primary" onclick="window.ui.show2FASettings()">返回</button>
                            </div>
                        </div>
                    `;
                }
                
                this.showToast('备用代码已重新生成');
            } else {
                const data = await res.json();
                this.showToast(data.message || data.error || '重新生成失败', false);
            }
        } catch (e) {
            console.error('重新生成备用代码失败:', e);
            this.showToast('重新生成失败', false);
        }
    },
    
    // 关闭 2FA 模态框
    close2FAModal() {
        const modal = document.getElementById('2fa-modal');
        if (modal) modal.style.display = 'none';
    },
    
    // 更新 2FA 状态显示
    update2FAStatus(enabled) {
        const statusDiv = document.getElementById('2fa-status');
        const statusText = document.getElementById('2fa-status-text');

        if (statusDiv && statusText) {
            statusDiv.style.display = 'block';
            statusText.textContent = enabled ? '已启用 ✅' : '未启用';
            statusText.style.color = enabled ? 'var(--green)' : 'var(--gray)';
        }
    }
};

// 导出
window.ui = UIManager;
