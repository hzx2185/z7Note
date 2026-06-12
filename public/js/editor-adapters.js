// 编辑器适配器系统 - 只使用 CodeMirror

function waitForCodeMirrorReady(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        if (window.CodeMirror) {
            resolve(window.CodeMirror);
            return;
        }

        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            if (window.CodeMirror) {
                window.clearInterval(timer);
                resolve(window.CodeMirror);
                return;
            }

            if (Date.now() - startedAt >= timeoutMs) {
                window.clearInterval(timer);
                reject(new Error('CodeMirror core did not finish loading.'));
            }
        }, 50);
    });
}

// CodeMirror 上传辅助函数
async function uploadFileAndInsertCodeMirror(editor, file, ui) {
    const placeholder = ` [上传中: ${file.name}] `;
    const cursor = editor.getCursor();

    // 插入占位符
    editor.replaceRange(placeholder, cursor);
    editor.setCursor(editor.posFromIndex(editor.indexFromPos(cursor) + placeholder.length));
    editor.focus();
    ui.save();

    // 显示上传进度
    if (window.api && window.api.showUploadProgress) {
        window.api.showUploadProgress(true, `上传中: ${file.name}`, 0, window.api.formatFileSize(file.size));
    }

    try {
        // 使用分片上传
        const data = await window.api.uploadFileInChunks(file, (percent, text, details) => {
            if (window.api && window.api.showUploadProgress) {
                window.api.showUploadProgress(true, text, percent, details);
            }
        });

        // 替换占位符
        const content = editor.getValue();
        const pos = content.indexOf(placeholder);
        if (pos > -1) {
            const isImg = file.type.startsWith('image/');
            const fileName = data.url.split('/').pop();
            const tag = isImg ? `![${fileName}](${data.url})` : `[${file.name}](${data.url})`;
            editor.setValue(content.substring(0, pos) + tag + content.substring(pos + placeholder.length));
            editor.setCursor(editor.posFromIndex(pos + tag.length));
            ui.save();
            ui.updatePreview();
            ui.showToast(`上传成功: ${file.name}`);
        }

        // 延迟隐藏进度条
        if (window.api && window.api.showUploadProgress) {
            setTimeout(() => {
                window.api.showUploadProgress(false);
            }, 1000);
        }
    } catch (e) {
        console.error('上传失败:', e);
        alert(`上传失败: ${e.message || file.name}`);

        // 显示错误信息
        if (window.api && window.api.showUploadProgress) {
            window.api.showUploadProgress(true, '上传失败', 0, e.message);
            setTimeout(() => {
                window.api.showUploadProgress(false);
            }, 3000);
        }

        // 移除占位符
        const content = editor.getValue();
        const pos = content.indexOf(placeholder);
        if (pos > -1) {
            editor.setValue(content.substring(0, pos) + content.substring(pos + placeholder.length));
            editor.setCursor(editor.posFromIndex(pos));
            ui.save();
        }
    }
}

// CodeMirror 适配器
const CodeMirrorAdapter = {
    name: 'codemirror',
    display: 'CodeMirror 编辑器',
    element: null,

    async create(container, content, options) {
        const ui = window.ui;
        const isIOS = /iP(hone|od|ad)/.test(navigator.platform)
            || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);
        const isTouchPhone = isIOS
            || (window.matchMedia
                ? window.matchMedia('(max-width: 768px) and (pointer: coarse)').matches
                : window.innerWidth <= 768);
        const cleanupFns = [];

        // 检查是否显示行号 - 默认显示
        const storedLineNumbers = localStorage.getItem('show-line-numbers');
        const showLineNumbers = storedLineNumbers === null
            ? true
            : storedLineNumbers !== 'false';

        // 同步设置容器类名
        if (showLineNumbers) {
            container.classList.add('show-line-numbers');
        } else {
            container.classList.remove('show-line-numbers');
        }

        // 检查是否自动换行 - 默认开启
        const lineWrapping = localStorage.getItem('line-wrapping') !== 'false';

        const CodeMirrorCtor = await waitForCodeMirrorReady();

        // 创建 CodeMirror 实例
        const editor = CodeMirrorCtor(container, {
            value: content || '',
            mode: 'markdown',
            lineNumbers: showLineNumbers,
            lineWrapping: lineWrapping,
            matchBrackets: true,
            autoCloseBrackets: true,
            autofocus: !isTouchPhone,
            viewportMargin: isTouchPhone ? 10 : 20,
            undoDepth: 200,
            gutters: showLineNumbers ? ['CodeMirror-linenumbers', 'CodeMirror-activeline-gutter'] : ['CodeMirror-activeline-gutter'],
            styleActiveLine: true,
            inputStyle: 'contenteditable',
            spellcheck: false,
            autocorrect: false
        });

        // 防抖函数
        const debounce = function(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        };

        const keepMobileKeyboardClosedOnInit = () => {
            if (!isTouchPhone) return;

            const blurEditorInput = () => {
                try {
                    const inputEl = editor.getInputField && editor.getInputField();
                    if (inputEl && document.activeElement === inputEl) {
                        inputEl.blur();
                    }
                    if (editor.hasFocus && editor.hasFocus()) {
                        editor.getInputField()?.blur();
                    }
                    if (
                        document.activeElement &&
                        editor.getWrapperElement().contains(document.activeElement) &&
                        typeof document.activeElement.blur === 'function'
                    ) {
                        document.activeElement.blur();
                    }
                } catch (e) {}
            };

            requestAnimationFrame(blurEditorInput);
            setTimeout(blurEditorInput, 80);
            setTimeout(blurEditorInput, 260);
        };

        const setupMobileViewport = () => {
            if (!isTouchPhone) return null;

            const root = document.documentElement;
            const body = document.body;
            const vv = window.visualViewport;
            let editorFocused = false;
            let keyboardPrimed = false;
            let viewportTimer = null;

            root.classList.toggle('ios-visual-viewport', Boolean(isIOS && vv));

            const setViewportVars = () => {
                const visualHeight = vv ? vv.height : window.innerHeight;
                const visualOffsetTop = vv ? vv.offsetTop : 0;
                const layoutHeight = Math.max(
                    window.innerHeight || 0,
                    document.documentElement.clientHeight || 0,
                    window.screen?.height || 0
                );
                const keyboardOverlap = vv
                    ? Math.max(0, layoutHeight - visualHeight - visualOffsetTop)
                    : 0;
                const keyboardLikelyOpen = editorFocused
                    && (keyboardPrimed || keyboardOverlap > 80 || layoutHeight - visualHeight > 120);

                root.style.setProperty('--app-visual-height', `${Math.round(visualHeight)}px`);
                root.style.setProperty('--app-visual-offset-top', `${Math.round(visualOffsetTop)}px`);
                root.style.setProperty('--app-keyboard-overlap', `${Math.round(keyboardOverlap)}px`);
                root.style.setProperty('--app-editor-bottom-safe', keyboardLikelyOpen ? '88px' : '44px');
                body.classList.toggle('mobile-editor-focused', editorFocused);
                body.classList.toggle('mobile-editor-keyboard', keyboardLikelyOpen);
            };

            const refreshAroundCursor = () => {
                clearTimeout(viewportTimer);
                viewportTimer = setTimeout(() => {
                    if (!editor) return;
                    editor.refresh();
                    if (editorFocused) {
                        const cursor = editor.getCursor();
                        editor.scrollIntoView(cursor, keyboardPrimed ? 140 : 96);
                        if (keyboardPrimed) {
                            const cursorCoords = editor.cursorCoords(cursor, 'local');
                            const scrollInfo = editor.getScrollInfo();
                            const targetTop = Math.max(0, cursorCoords.top - scrollInfo.clientHeight * 0.32);
                            if (cursorCoords.bottom > scrollInfo.top + scrollInfo.clientHeight * 0.62) {
                                editor.scrollTo(null, targetTop);
                            }
                        }
                    }
                }, 80);
            };

            const syncViewport = () => {
                setViewportVars();
                refreshAroundCursor();
            };

            const onFocus = () => {
                editorFocused = true;
                keyboardPrimed = true;
                body.classList.add('mobile-editor-focused', 'mobile-editor-keyboard');
                syncViewport();
                setTimeout(syncViewport, 180);
                setTimeout(syncViewport, 420);
            };

            const onBlur = () => {
                editorFocused = false;
                keyboardPrimed = false;
                setTimeout(syncViewport, 80);
            };

            editor.on('focus', onFocus);
            editor.on('blur', onBlur);
            setViewportVars();

            if (vv) {
                vv.addEventListener('resize', syncViewport, { passive: true });
                vv.addEventListener('scroll', syncViewport, { passive: true });
            }
            window.addEventListener('orientationchange', syncViewport, { passive: true });
            window.addEventListener('resize', syncViewport, { passive: true });

            const inputEl = editor.getInputField && editor.getInputField();
            if (inputEl) {
                inputEl.setAttribute('autocapitalize', 'off');
                inputEl.setAttribute('autocomplete', 'off');
                inputEl.setAttribute('autocorrect', 'off');
                inputEl.setAttribute('enterkeyhint', 'enter');
                inputEl.setAttribute('inputmode', 'text');
                inputEl.setAttribute('spellcheck', 'false');
            }

            return () => {
                clearTimeout(viewportTimer);
                editor.off('focus', onFocus);
                editor.off('blur', onBlur);
                if (vv) {
                    vv.removeEventListener('resize', syncViewport);
                    vv.removeEventListener('scroll', syncViewport);
                }
                window.removeEventListener('orientationchange', syncViewport);
                window.removeEventListener('resize', syncViewport);
                root.classList.remove('ios-visual-viewport');
                root.style.removeProperty('--app-editor-bottom-safe');
                body.classList.remove('mobile-editor-focused', 'mobile-editor-keyboard');
            };
        };
        
        // 添加数字高亮 - 优化性能：只处理可见区域
        const highlightNumbers = function() {
            if (!editor) return;
            
            // 清除旧的标记
            if (editor.getAllMarks) {
                const marks = editor.getAllMarks();
                marks.forEach(mark => {
                    const markClass = mark.attributes && mark.attributes.class || mark.className;
                    if (markClass === 'cm-custom-number') {
                        mark.clear();
                    }
                });
            }
            
            // 仅遍历可见区域（前后各多加10行作为缓冲区）
            const scrollInfo = editor.getScrollInfo();
            const from = editor.lineAtHeight(scrollInfo.top, 'local');
            const to = editor.lineAtHeight(scrollInfo.top + scrollInfo.clientHeight, 'local');
            
            const lineCount = editor.lineCount();
            const startLine = Math.max(0, from - 10);
            const endLine = Math.min(lineCount - 1, to + 10);
            
            editor.operation(() => {
                for (let i = startLine; i <= endLine; i++) {
                    const line = editor.getLine(i);
                    if (!line) continue;
                    
                    // 查找所有数字
                    const regex = /\b\d+(\.\d+)?\b/g;
                    let match;
                    
                    while ((match = regex.exec(line)) !== null) {
                        // 排除列表项序号（行首的数字加点号）
                        if (match.index === 0 && /^\d+\./.test(line)) {
                            continue;
                        }
                        
                        // 标记数字
                        editor.markText(
                            {line: i, ch: match.index},
                            {line: i, ch: match.index + match[0].length},
                            {
                                className: 'cm-custom-number',
                                inclusiveLeft: false,
                                inclusiveRight: false
                            }
                        );
                    }
                }
            });
        };
        
        // 初始高亮
        setTimeout(highlightNumbers, 300);
        
        // 监听事件
        const debouncedViewportHighlight = debounce(highlightNumbers, 100);
        const debouncedChangeHighlight = debounce(highlightNumbers, 300);
        const debouncedRefreshHighlight = debounce(highlightNumbers, 100);
        const debouncedResizeHighlight = debounce(highlightNumbers, 200);
        editor.on('viewportChange', debouncedViewportHighlight);
        editor.on('change', debouncedChangeHighlight);
        editor.on('refresh', debouncedRefreshHighlight);
        window.addEventListener('resize', debouncedResizeHighlight);
        cleanupFns.push(() => {
            editor.off('viewportChange', debouncedViewportHighlight);
            editor.off('change', debouncedChangeHighlight);
            editor.off('refresh', debouncedRefreshHighlight);
            window.removeEventListener('resize', debouncedResizeHighlight);
        });
        const mobileViewportCleanup = setupMobileViewport();
        if (mobileViewportCleanup) cleanupFns.push(mobileViewportCleanup);
        
        editor.hasNumberHighlight = true;


        // 输入事件 - 防抖保存
        let saveTimeout = null;
        let lastContent = editor.getValue();
        let isComposing = false; // 是否正在进行输入法输入
        let isProgrammaticChange = false; // 是否是程序设置值

        // 监听输入法开始事件
        editor.on('compositionstart', () => {
            isComposing = true;
            const uiManager = window.ui || ui;
            if (uiManager) {
                uiManager._isComposing = true;
            }
        });

        // 监听输入法结束事件
        editor.on('compositionend', () => {
            const currentContent = editor.getValue();
            if (currentContent === lastContent) {
                isComposing = false;
                if (window.ui) window.ui._isComposing = false;
                return;
            }
            lastContent = currentContent;

            // 缩短延迟
            setTimeout(() => {
                isComposing = false;
                const uiManager = window.ui || ui;
                if (uiManager) {
                    uiManager._isComposing = false;
                    if (uiManager.save) uiManager.save();
                    if (uiManager.updatePreview) uiManager.updatePreview();
                }
            }, 20);
        });

        editor.on('change', () => {
            if (isComposing) return;

            if (isProgrammaticChange) {
                isProgrammaticChange = false;
                lastContent = editor.getValue();
                return;
            }

            const currentContent = editor.getValue();
            if (currentContent === lastContent) return;
            lastContent = currentContent;

            const uiManager = window.ui || ui;
            if (uiManager && uiManager.updateStatus) {
                uiManager.updateStatus('working', '编辑中...');
            }

            if (uiManager && uiManager.updatePreview) {
                uiManager.updatePreview();
            }

            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                try {
                    if (uiManager && uiManager.save) {
                        const saved = await uiManager.save();
                        if (saved === false) {
                            if (uiManager && uiManager.updateStatus) {
                                uiManager.updateStatus('error', '保存失败');
                            }
                            return;
                        }
                        if (saved === 'queued') {
                            if (uiManager && uiManager.updateStatus) {
                                uiManager.updateStatus('working', '保存中...');
                            }
                            return;
                        }
                    }
                    if (uiManager && uiManager.updateStatus) {
                        uiManager.updateStatus('success', '已保存');
                        setTimeout(() => {
                            if (uiManager && uiManager.updateStatus) {
                                uiManager.updateStatus('idle', '就绪');
                            }
                        }, 1000);
                    }
                } catch (e) {
                    if (uiManager && uiManager.updateStatus) {
                        uiManager.updateStatus('error', '保存失败');
                    }
                }
            }, 1000); 
        });

        // 滚动事件
        editor.on('scroll', () => {
            if (options && options.onScroll) {
                options.onScroll();
            }
        });

        // 选择变化事件
        editor.on('cursorActivity', () => {
            if (options && options.onSelectionChange) {
                options.onSelectionChange();
            }
        });

        let lastSelectedLine = null;
        let lastTouchSelectionTime = 0; // 防止触摸和点击双重触发
        let mobileSelectedLineHandle = null;

        const clearMobileSelectedLine = () => {
            if (!mobileSelectedLineHandle) return;
            try {
                editor.removeLineClass(mobileSelectedLineHandle, 'wrap', 'mobile-gutter-selected-line');
                editor.removeLineClass(mobileSelectedLineHandle, 'background', 'mobile-gutter-selected-line-bg');
            } catch (e) {}
            mobileSelectedLineHandle = null;
        };

        const markMobileSelectedLine = (line) => {
            if (!isTouchPhone) return;
            clearMobileSelectedLine();
            try {
                mobileSelectedLineHandle = editor.addLineClass(line, 'wrap', 'mobile-gutter-selected-line');
                editor.addLineClass(line, 'background', 'mobile-gutter-selected-line-bg');
            } catch (e) {}
        };

        const selectLineRange = (startLine, endLine) => {
            const rangeStartLine = Math.min(startLine, endLine);
            const rangeEndLine = Math.max(startLine, endLine);
            const lineCount = editor.lineCount();
            const to = rangeEndLine + 1 < lineCount
                ? { line: rangeEndLine + 1, ch: 0 }
                : { line: rangeEndLine, ch: (editor.getLine(rangeEndLine) || '').length };
            
            editor.setSelection(
                { line: rangeStartLine, ch: 0 },
                to
            );
            editor.scrollIntoView({ line: rangeStartLine, ch: 0 }, 64);
        };

        const selectSingleLine = (line) => {
            const lineText = editor.getLine(line);
            if (lineText === undefined) return false;
            const lineCount = editor.lineCount();
            const to = line + 1 < lineCount
                ? { line: line + 1, ch: 0 }
                : { line: line, ch: lineText.length };
            
            editor.setSelection(
                { line: line, ch: 0 },
                to
            );
            editor.scrollIntoView({ line, ch: 0 }, 64);
            markMobileSelectedLine(line);
            return true;
        };

        // 处理行号点击：手机端单点始终只选当前行，桌面端 Shift+点击选范围。
        const handleLineNumberClick = (line, event = null) => {
            const isRangeSelect = event?.shiftKey && lastSelectedLine !== null && lastSelectedLine !== line;

            if (isRangeSelect) {
                selectLineRange(lastSelectedLine, line);
            } else {
                selectSingleLine(line);
            }

            lastSelectedLine = line;
        };

        const isEditorFocused = () => {
            try {
                return Boolean(editor.hasFocus?.() || editor.getWrapperElement().contains(document.activeElement));
            } catch (e) {
                return false;
            }
        };

        const blurMobileEditorInput = () => {
            try {
                editor.getInputField?.()?.blur?.();
                if (editor.getWrapperElement().contains(document.activeElement)) {
                    document.activeElement?.blur?.();
                }
                document.body.classList.remove('mobile-editor-focused', 'mobile-editor-keyboard');
            } catch (e) {}
        };

        const applyLineNumberSelection = (line, event = null) => {
            const shouldKeepEditorFocus = !isTouchPhone
                || document.body.classList.contains('mobile-editor-keyboard')
                || isEditorFocused();
            const keepMobileKeyboardClosed = isTouchPhone && !shouldKeepEditorFocus;

            if (shouldKeepEditorFocus) {
                try {
                    editor.focus();
                } catch (e) {}
            }

            handleLineNumberClick(line, event);
            if (keepMobileKeyboardClosed) {
                requestAnimationFrame(blurMobileEditorInput);
            }

            if (isTouchPhone) {
                setTimeout(() => {
                    handleLineNumberClick(line, event);
                    if (keepMobileKeyboardClosed) {
                        blurMobileEditorInput();
                    }
                }, 60);
            }
        };

        const clampLine = (line) => {
            if (!Number.isFinite(line)) return null;
            return Math.max(0, Math.min(editor.lineCount() - 1, line));
        };

        const getLineNumberGutter = () => editor.getWrapperElement().querySelector('.CodeMirror-linenumbers');

        const asElement = (target) => {
            if (target instanceof Element) return target;
            return target?.parentElement || null;
        };

        const getLineNumberElement = (target) => {
            return asElement(target)?.closest('.CodeMirror-linenumber') || null;
        };

        const lineFromLineNumberElement = (lineNumberElement) => {
            if (!lineNumberElement) return null;

            const rawNumber = Number.parseInt((lineNumberElement.textContent || '').trim(), 10);
            if (Number.isFinite(rawNumber)) {
                const firstLineNumber = editor.getOption('firstLineNumber') || 1;
                const line = clampLine(rawNumber - firstLineNumber);
                if (line !== null) return line;
            }

            const rect = lineNumberElement.getBoundingClientRect();
            return clampLine(editor.lineAtHeight(rect.top + rect.height / 2, 'client'));
        };

        const pointFromEvent = (event) => {
            const source = event.changedTouches?.[0] || event.touches?.[0] || event;
            if (!source || source.clientX === undefined || source.clientY === undefined) return null;
            return { x: source.clientX, y: source.clientY };
        };

        const lineFromMobileGutterPoint = (point) => {
            if (!point || !isTouchPhone) return null;

            const wrapperRect = editor.getWrapperElement().getBoundingClientRect();
            if (point.y < wrapperRect.top || point.y > wrapperRect.bottom) return null;

            const gutter = getLineNumberGutter();
            const gutterRect = gutter?.getBoundingClientRect();
            const mobileGutterHitWidth = 36;
            const gutterLeft = gutterRect ? gutterRect.left : wrapperRect.left;
            const gutterRight = gutterRect
                ? Math.max(gutterRect.right, gutterRect.left + mobileGutterHitWidth)
                : wrapperRect.left + mobileGutterHitWidth;

            if (point.x < gutterLeft || point.x > gutterRight) return null;
            return clampLine(editor.lineAtHeight(point.y, 'client'));
        };

        const isLineNumberGutterPoint = (target, point) => {
            if (getLineNumberElement(target)) return true;
            if (asElement(target)?.closest('.CodeMirror-linenumbers')) return true;

            const lineNumberGutter = getLineNumberGutter();
            if (!lineNumberGutter || !point) return false;

            const rect = lineNumberGutter.getBoundingClientRect();
            return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
        };

        const lineFromGutterEvent = (event) => {
            const point = pointFromEvent(event);
            if (!isLineNumberGutterPoint(event.target, point)) return null;

            const directLine = lineFromLineNumberElement(getLineNumberElement(event.target));
            if (directLine !== null) return directLine;

            if (point && document.elementsFromPoint) {
                const lineNumberElement = document.elementsFromPoint(point.x, point.y)
                    .find((element) => element.classList?.contains('CodeMirror-linenumber'));
                const pointLine = lineFromLineNumberElement(lineNumberElement);
                if (pointLine !== null) return pointLine;
            }

            if (!point) return null;
            return clampLine(editor.lineAtHeight(point.y, 'client'));
        };

        const lineFromMobileTouchEvent = (event) => {
            const point = pointFromEvent(event);
            const eventLine = lineFromGutterEvent(event);
            if (eventLine !== null) return eventLine;
            return lineFromMobileGutterPoint(point);
        };

        // 针对触摸屏的优化：触摸结束后按左侧行号命中带选行，避免被 Safari/CodeMirror 后续流程覆盖。
        const wrapperElement = editor.getWrapperElement();
        if (wrapperElement) {
            let pendingTouchLine = null;

            const rememberTouchGutterLine = (e) => {
                pendingTouchLine = lineFromMobileTouchEvent(e);
                if (pendingTouchLine === null) return;
                e.preventDefault();
                e.stopPropagation();
            };

            const commitTouchGutterSelection = (e) => {
                const line = pendingTouchLine ?? lineFromMobileTouchEvent(e);
                pendingTouchLine = null;
                if (line === null) return;

                e.preventDefault();
                e.stopPropagation();

                lastTouchSelectionTime = Date.now();
                requestAnimationFrame(() => {
                    applyLineNumberSelection(line, e);
                });
            };

            const cancelPendingTouchGutterSelection = () => {
                pendingTouchLine = null;
            };

            const handleMobileGutterClick = (e) => {
                if (!isTouchPhone || Date.now() - lastTouchSelectionTime < 50) return;
                const line = lineFromMobileTouchEvent(e);
                if (line === null) return;
                e.preventDefault();
                e.stopPropagation();
                lastTouchSelectionTime = Date.now();
                applyLineNumberSelection(line, e);
            };

            const suppressSyntheticTouchMouse = (e) => {
                if (!isTouchPhone || Date.now() - lastTouchSelectionTime > 900) return;
                if (lineFromMobileTouchEvent(e) === null) return;
                e.preventDefault();
                e.stopPropagation();
            };

            wrapperElement.addEventListener('touchstart', rememberTouchGutterLine, { passive: false, capture: true });
            wrapperElement.addEventListener('touchend', commitTouchGutterSelection, { passive: false, capture: true });
            wrapperElement.addEventListener('touchcancel', cancelPendingTouchGutterSelection, true);
            wrapperElement.addEventListener('mousedown', suppressSyntheticTouchMouse, true);
            wrapperElement.addEventListener('click', handleMobileGutterClick, true);
            cleanupFns.push(() => {
                wrapperElement.removeEventListener('touchstart', rememberTouchGutterLine, { capture: true });
                wrapperElement.removeEventListener('touchend', commitTouchGutterSelection, { capture: true });
                wrapperElement.removeEventListener('touchcancel', cancelPendingTouchGutterSelection, true);
                wrapperElement.removeEventListener('mousedown', suppressSyntheticTouchMouse, true);
                wrapperElement.removeEventListener('click', handleMobileGutterClick, true);
            });
        }

        // 电脑端行号点击事件 (增加时间检查防止与手机触摸冲突)
        editor.on('gutterClick', (cm, line, gutter, e) => {
            if (gutter !== 'CodeMirror-linenumbers') return;
            // 如果最近 500ms 内刚刚通过 touch 选中过，则忽略本次点击
            if (Date.now() - lastTouchSelectionTime < 500) return;
            if (e && e.preventDefault) e.preventDefault();
            applyLineNumberSelection(line, e);
        });
        keepMobileKeyboardClosedOnInit();

        // 粘贴事件处理
        editor.on('paste', (editor, event) => {
            const items = event.clipboardData?.items;
            if (!items) return;

            const files = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }

            if (files.length > 0) {
                event.preventDefault();
                for (const file of files) {
                    uploadFileAndInsertCodeMirror(editor, file, ui);
                }
            }
        });

        // 拖拽事件处理
        editor.on('dragover', (editor, event) => {
            event.preventDefault();
            event.stopPropagation();
            editor.getWrapperElement().style.backgroundColor = 'rgba(37, 99, 235, 0.05)';
        });

        editor.on('dragleave', (editor, event) => {
            event.preventDefault();
            event.stopPropagation();
            editor.getWrapperElement().style.backgroundColor = '';
        });

        editor.on('drop', (editor, event) => {
            event.preventDefault();
            event.stopPropagation();
            editor.getWrapperElement().style.backgroundColor = '';

            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return;

            for (const file of files) {
                uploadFileAndInsertCodeMirror(editor, file, ui);
            }
        });

        // 保存引用
        this.element = editor;

        // 返回兼容对象
        return {
            tagName: 'CODEMIRROR',
            value: editor.getValue(),
            scrollHeight: editor.getScrollInfo().height,
            clientHeight: editor.getScrollInfo().clientHeight,
            scrollTop: editor.getScrollInfo().top,
            selectionStart: editor.indexFromPos(editor.getCursor('from')),
            selectionEnd: editor.indexFromPos(editor.getCursor('to')),
            focus: () => editor.focus(),
            select: () => editor.execCommand('selectAll'),
            scrollTo: (options) => {
                if (options && options.top !== undefined) {
                    editor.scrollTo(null, options.top);
                }
            },
            destroy: () => {
                while (cleanupFns.length) {
                    const cleanup = cleanupFns.pop();
                    try {
                        cleanup();
                    } catch (e) {}
                }
                try {
                    if (editor && typeof editor.toTextArea === 'function') {
                        editor.toTextArea();
                        return true;
                    }
                } catch (e) {}
                try {
                    const wrapper = editor.getWrapperElement();
                    if (wrapper && wrapper.parentNode) {
                        wrapper.parentNode.removeChild(wrapper);
                        return true;
                    }
                } catch (e) {}
                return false;
            },
            // 适配器接口
            getValue: () => editor.getValue(),
            setValue: (val) => {
                isProgrammaticChange = true;
                editor.operation(() => {
                    const cursor = editor.getCursor();
                    editor.setValue(val);
                    try {
                        const lineCount = editor.lineCount();
                        if (lineCount > 0) {
                            const targetLine = Math.min(cursor.line, lineCount - 1);
                            editor.setCursor({ line: targetLine, ch: cursor.ch });
                        }
                    } catch (e) {}
                });
                editor.refresh();
            },
            getSelection: () => editor.getSelection(),
            setSelection: (start, end) => {
                editor.setSelection(editor.posFromIndex(start), editor.posFromIndex(end));
            },
            getCursorPos: () => editor.indexFromPos(editor.getCursor()),
            executeEdits: (source, edits) => {
                if (edits && edits.length > 0) {
                    const edit = edits[0];
                    editor.replaceSelection(edit.text);
                    ui.updatePreview();
                }
            },
            getPosition: () => editor.getCursor(),
            setPosition: (pos) => editor.setCursor(pos),
            getCursor: () => editor.getCursor(),
            setCursor: (pos) => editor.setCursor(pos),
            refresh: () => editor.refresh(),
            toggleLineNumbers: (show) => {
                editor.setOption('lineNumbers', show);
                editor.setOption('gutters', show ? ['CodeMirror-linenumbers', 'CodeMirror-activeline-gutter'] : ['CodeMirror-activeline-gutter']);
                editor.refresh();
            },
            toggleLineWrapping: (wrap) => {
                editor.setOption('lineWrapping', wrap);
                editor.refresh();
                localStorage.setItem('line-wrapping', wrap ? 'true' : 'false');
            },
            trigger: (source, actionId, payload) => {
                if (actionId === 'undo') editor.execCommand('undo');
                if (actionId === 'redo') editor.execCommand('redo');
                if (actionId === 'actions.find') alert('使用 Ctrl+F 查找');
            },
            getAction: (actionId) => ({ run: () => {} }),
            getModel: () => ({
                getValue: () => editor.getValue(),
                setValue: (val) => editor.setValue(val),
                getFullModelRange: () => ({ 
                    startLineNumber: 1, 
                    endLineNumber: editor.lineCount() + 1, 
                    startColumn: 0, 
                    endColumn: editor.getValue().length 
                }),
                getValueInRange: (range) => {
                    if (!range) return editor.getValue();
                    const from = editor.posFromIndex(0);
                    const to = editor.posFromIndex(editor.getValue().length);
                    return editor.getRange(from, to);
                },
                getPositionAt: (offset) => editor.posFromIndex(offset),
                getOffsetAt: (pos) => editor.indexFromPos(pos)
            }),
            getScrollTop: () => editor.getScrollInfo().top,
            getScrollHeight: () => editor.getScrollInfo().height,
            setScrollTop: (top) => editor.scrollTo(null, top),
            getLayoutInfo: () => ({
                height: editor.getScrollInfo().clientHeight,
                width: editor.getScrollInfo().clientWidth
            }),
            getWrapperElement: () => editor.getWrapperElement(),
            hasNumberHighlight: true,
            addLineClass: (line, where, cls) => editor.addLineClass(line, where, cls),
            removeLineClass: (line, where, cls) => editor.removeLineClass(line, where, cls),
            markText: (from, to, options) => editor.markText(from, to, options),
            getAllMarks: () => editor.getAllMarks(),
            scrollIntoView: (pos, margin) => editor.scrollIntoView(pos, margin),
            _editor: editor
        };
    }
};

// 编辑器管理器 - 统一接口
const EditorAdapterManager = {
    adapters: {
        codemirror: CodeMirrorAdapter
    },
    currentType: null,
    currentEditor: null,

    destroyCurrentEditor() {
        if (this.currentEditor && this.currentEditor.destroy) {
            try {
                this.currentEditor.destroy();
            } catch (e) {
                console.error('销毁编辑器失败:', e);
            }
        }
        this.currentEditor = null;
    },

    getEditorType() {
        let type = localStorage.getItem('editorType') || 'codemirror';
        if (!this.adapters[type]) {
            type = 'codemirror';
            localStorage.setItem('editorType', 'codemirror');
        }
        return type;
    },

    setEditorType(type) {
        if (!this.adapters[type]) return false;
        localStorage.setItem('editorType', type);
        return true;
    },

    async createEditor(container, content, options) {
        const type = this.getEditorType();
        this.currentType = type;

        this.destroyCurrentEditor();

        if (container) {
            container.innerHTML = '';
        }

        const adapter = this.adapters[type];
        this.currentEditor = await adapter.create(container, content, options);
        if (!this.currentEditor) {
            throw new Error(`Editor adapter "${type}" did not return an editor instance.`);
        }
        this.currentEditor.adapterName = type;
        return this.currentEditor;
    },

    getCurrentEditor() {
        return this.currentEditor;
    },

    getCurrentType() {
        return this.currentType;
    }
};

window.EditorAdapterManager = EditorAdapterManager;
