// 编辑器适配器系统 - 只使用 CodeMirror

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

        // 检查是否显示行号 - 默认显示
        const showLineNumbers = localStorage.getItem('show-line-numbers') !== 'false';

        // 同步设置容器类名
        if (showLineNumbers) {
            container.classList.add('show-line-numbers');
        } else {
            container.classList.remove('show-line-numbers');
        }

        // 检查是否自动换行 - 默认开启
        const lineWrapping = localStorage.getItem('line-wrapping') !== 'false';

        // 创建 CodeMirror 实例
        const editor = CodeMirror(container, {
            value: content || '',
            mode: 'markdown',
            lineNumbers: showLineNumbers,
            lineWrapping: lineWrapping,
            matchBrackets: true,
            autoCloseBrackets: true,
            autofocus: true,
            viewportMargin: 20,
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
        editor.on('viewportChange', debounce(highlightNumbers, 100));
        editor.on('change', debounce(highlightNumbers, 300));
        editor.on('refresh', debounce(highlightNumbers, 100));
        window.addEventListener('resize', debounce(highlightNumbers, 200));
        
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

        // 存储上次点击行号及时间，用于5秒内连选
        let lastGutterClickLine = null;
        let lastGutterClickTime = 0;
        let lastTouchSelectionTime = 0; // 防止触摸和点击双重触发
        const RANGE_CLICK_INTERVAL = 5000;

        const selectLineRange = (startLine, endLine) => {
            const rangeStartLine = Math.min(startLine, endLine);
            const rangeEndLine = Math.max(startLine, endLine);
            const lastLineText = editor.getLine(rangeEndLine) || '';
            
            editor.setSelection(
                { line: rangeStartLine, ch: 0 },
                { line: rangeEndLine, ch: lastLineText.length }
            );
        };

        const selectSingleLine = (line) => {
            const lineText = editor.getLine(line);
            if (lineText === undefined) return false;
            
            editor.setSelection(
                { line: line, ch: 0 },
                { line: line, ch: lineText.length }
            );
            return true;
        };

        // 处理行号点击的主逻辑 (不抑制键盘，确保选中 100% 成功)
        const handleLineNumberClick = (line) => {
            const now = Date.now();
            
            const isRangeSelect = 
                lastGutterClickLine !== null && 
                now - lastGutterClickTime <= RANGE_CLICK_INTERVAL && 
                lastGutterClickLine !== line;

            if (isRangeSelect) {
                selectLineRange(lastGutterClickLine, line);
                lastGutterClickLine = null;
                lastGutterClickTime = 0;
            } else {
                if (selectSingleLine(line)) {
                    lastGutterClickLine = line;
                    lastGutterClickTime = now;
                }
            }
        };

        // 针对触摸屏的优化：在 touchstart 阶段立即选中，确保点击一次就生效
        const gutterElement = editor.getWrapperElement().querySelector('.CodeMirror-gutters');
        if (gutterElement) {
            gutterElement.addEventListener('touchstart', (e) => {
                const target = e.target;
                if (!target.closest('.CodeMirror-linenumbers')) return;

                const touch = e.changedTouches ? e.changedTouches[0] : e;
                const line = editor.lineAtHeight(touch.clientY, 'client');
                
                if (line >= 0 && line < editor.lineCount()) {
                    lastTouchSelectionTime = Date.now();
                    handleLineNumberClick(line);
                }
            }, { passive: true });
        }

        // 电脑端行号点击事件 (增加时间检查防止与手机触摸冲突)
        editor.on('gutterClick', (cm, line, gutter, e) => {
            if (gutter !== 'CodeMirror-linenumbers') return;
            // 如果最近 500ms 内刚刚通过 touch 选中过，则忽略本次点击
            if (Date.now() - lastTouchSelectionTime < 500) return;
            handleLineNumberClick(line);
        });

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
