export function enhanceUIPreviewRenderer(UIManager) {
    Object.assign(UIManager, {
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
    });
}
