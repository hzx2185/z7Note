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
        ui.showToast(`上传失败: ${e.message || file.name}`, false);

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
            gutters: showLineNumbers ? ['CodeMirror-linenumbers', 'CodeMirror-activeline-gutter'] : ['CodeMirror-activeline-gutter'],
            styleActiveLine: true
        });

        // 防抖函数
        const debounce = function(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        };
        
        // 添加数字高亮
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
            
            // 遍历每一行
            const lineCount = editor.lineCount();
            let totalMarked = 0;
            
            for (let i = 0; i < lineCount; i++) {
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
                    totalMarked++;
                }
            }
        };
        
        // 初始高亮 - 延迟确保编辑器完全加载
        setTimeout(highlightNumbers, 500);
        
        // 监听编辑器视图变化
        editor.on('viewportChange', debounce(highlightNumbers, 300));
        
        // 内容变化时重新高亮
        editor.on('change', debounce(highlightNumbers, 300));
        
        // 监听编辑器刷新
        editor.on('refresh', debounce(highlightNumbers, 300));
        
        // 监听窗口大小变化
        window.addEventListener('resize', debounce(highlightNumbers, 300));
        
        editor.hasNumberHighlight = true;


        // 输入事件 - 防抖保存
        let saveTimeout = null;
        let lastContent = editor.getValue();
        let isComposing = false; // 是否正在进行输入法输入
        let compositionStartTime = 0; // 记录输入法开始时间
        let isProgrammaticChange = false; // 是否是程序设置值

        // 监听输入法开始事件
        editor.on('compositionstart', () => {
            isComposing = true;
            compositionStartTime = Date.now();
            const uiManager = window.ui || ui;
            if (uiManager) {
                uiManager._isComposing = true;
            }
        });

        // 监听输入法结束事件
        editor.on('compositionend', () => {
            const currentContent = editor.getValue();
            // 如果内容没有真正变化（只是输入过程中的临时状态），不处理
            if (currentContent === lastContent) {
                return;
            }
            lastContent = currentContent;

            // 等待一小段时间确保输入法完全结束
            setTimeout(() => {
                isComposing = false;
                const uiManager = window.ui || ui;
                if (uiManager) {
                    uiManager._isComposing = false;
                }
                // 输入法结束后，触发保存和预览更新
                if (uiManager && uiManager.save) {
                    uiManager.save();
                }
                if (uiManager && uiManager.updatePreview) {
                    uiManager.updatePreview();
                }
            }, 50);
        });

        editor.on('change', () => {
            // 如果正在使用输入法，不触发任何操作
            if (isComposing) {
                return;
            }

            // 如果是程序设置值，不触发保存
            if (isProgrammaticChange) {
                isProgrammaticChange = false;
                lastContent = editor.getValue();
                return;
            }

            const currentContent = editor.getValue();

            // 内容真正变化才处理
            if (currentContent === lastContent) return;
            lastContent = currentContent;

            const uiManager = window.ui || ui;

            // 显示编辑中状态
            if (uiManager && uiManager.updateStatus) {
                uiManager.updateStatus('working', '编辑中...');
            }

            // 立即触发预览更新（带防抖）
            if (uiManager && uiManager.updatePreview) {
                uiManager.updatePreview();
            }

            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                try {
                    if (uiManager && uiManager.save) {
                        await uiManager.save();
                    }
                    if (uiManager && uiManager.updateStatus) {
                        uiManager.updateStatus('success', '已保存');
                        setTimeout(() => {
                            if (uiManager && uiManager.updateStatus) {
                                uiManager.updateStatus('idle', '就绪');
                            }
                        }, 1500);
                    }
                } catch (e) {
                    if (uiManager && uiManager.updateStatus) {
                        uiManager.updateStatus('error', '保存失败');
                    }
                }
            }, 1500); // 延长到1500ms
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

        // 存储上次点击的行号，用于Shift+点击多选
        let lastClickedLine = null;
        
        // 多选模式状态（移动端）
        let isMultiSelectMode = false;
        let multiSelectStartLine = null;
        
        // 拖动多选状态（桌面端）
        let isDragging = false;
        let dragStartLine = null;

        // 长按检测（用于移动端）
        let longPressTimer = null;
        const LONG_PRESS_DURATION = 500; // 500ms 长按

        // 触摸开始 - 检测长按
        editor.on('gutterTouchstart', (cm, line, gutter, event) => {
            // 只处理行号gutter
            if (gutter !== 'CodeMirror-linenumbers') return;
            
            longPressTimer = setTimeout(() => {
                // 长按触发，进入多选模式
                isMultiSelectMode = true;
                multiSelectStartLine = line;
                window.ui && window.ui.showToast('已进入多选模式，点击其他行号选择范围', true);
            }, LONG_PRESS_DURATION);
        });

        // 触摸移动 - 取消长按
        editor.on('gutterTouchmove', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        });

        // 触摸结束 - 处理长按后的选择
        editor.on('gutterTouchend', (cm, line, gutter, event) => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            
            // 只处理行号gutter
            if (gutter !== 'CodeMirror-linenumbers') return;
            
            const lineHandle = cm.getLineHandle(line);
            if (!lineHandle) return;
            
            let start, end;
            
            // 如果在多选模式，选择范围
            if (isMultiSelectMode && multiSelectStartLine !== null) {
                const startLine = Math.min(multiSelectStartLine, line);
                const endLine = Math.max(multiSelectStartLine, line);
                
                start = { line: startLine, ch: 0 };
                end = { line: endLine, ch: cm.getLine(endLine).length };
                
                // 退出多选模式
                isMultiSelectMode = false;
                multiSelectStartLine = null;
            } else {
                // 普通点击，选中单行
                start = { line: line, ch: 0 };
                end = { line: line, ch: lineHandle.text.length };
            }
            
            cm.setSelection(start, end);
            cm.focus();
            lastClickedLine = line;
        });

        // 鼠标按下 - 开始拖动选择
        editor.on('gutterMouseDown', (cm, line, gutter, event) => {
            // 只处理行号gutter
            if (gutter !== 'CodeMirror-linenumbers') return;
            
            isDragging = true;
            dragStartLine = line;
            
            // 选中起始行
            const lineHandle = cm.getLineHandle(line);
            if (lineHandle) {
                cm.setSelection(
                    { line: line, ch: 0 },
                    { line: line, ch: lineHandle.text.length }
                );
            }
            cm.focus();
            lastClickedLine = line;
        });

        // 鼠标移动 - 拖动选择
        editor.on('gutterMouseover', (cm, line, gutter, event) => {
            // 只处理行号gutter
            if (gutter !== 'CodeMirror-linenumbers') return;
            if (!isDragging || dragStartLine === null) return;
            
            // 选择从起始行到当前行的所有内容
            const startLine = Math.min(dragStartLine, line);
            const endLine = Math.max(dragStartLine, line);
            
            cm.setSelection(
                { line: startLine, ch: 0 },
                { line: endLine, ch: cm.getLine(endLine).length }
            );
        });

        // 鼠标释放 - 结束拖动
        editor.on('gutterMouseup', (cm, line, gutter, event) => {
            isDragging = false;
            dragStartLine = null;
        });

        // 点击行号选中整行（桌面端）
        editor.on('gutterClick', (cm, line, gutter, clickEvent) => {
            // 只处理行号gutter
            if (gutter !== 'CodeMirror-linenumbers') return;
            
            // 选中整行
            const lineHandle = cm.getLineHandle(line);
            if (!lineHandle) return;
            
            let start, end;
            
            // 如果按住Shift键且上次有点击的行，则选中多行
            if (clickEvent.shiftKey && lastClickedLine !== null) {
                const startLine = Math.min(lastClickedLine, line);
                const endLine = Math.max(lastClickedLine, line);
                
                start = { line: startLine, ch: 0 };
                end = { line: endLine, ch: cm.getLine(endLine).length };
            } else {
                start = { line: line, ch: 0 };
                end = { line: line, ch: lineHandle.text.length };
            }
            
            cm.setSelection(start, end);
            
            // 聚焦编辑器
            cm.focus();
            
            // 记录本次点击的行号
            lastClickedLine = line;
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
            editor.getWrapperElement().style.backgroundColor = 'rgba(37, 99, 235, 0.1)';
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
                    } catch (e) {
                        // 忽略光标恢复错误
                    }
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
                    // 使用 replaceSelection 方法，它会自动替换选中的文本
                    // 如果没有选中文本，则在光标位置插入
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
                editor.setOption('gutters', show ? ['CodeMirror-linenumbers'] : []);
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
            })
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

    // 获取保存的编辑器类型
    getEditorType() {
        let type = localStorage.getItem('editorType') || 'codemirror';

        // 如果保存的类型不存在于可用适配器中,回退到 codemirror
        if (!this.adapters[type]) {

            type = 'codemirror';
            localStorage.setItem('editorType', 'codemirror');
        }

        return type;
    },

    // 设置编辑器类型
    setEditorType(type) {
        if (!this.adapters[type]) {
            return false;
        }
        localStorage.setItem('editorType', type);
        return true;
    },

    // 创建编辑器
    async createEditor(container, content, options) {
        const type = this.getEditorType();
        this.currentType = type;

        // 始终创建新编辑器实例，而不是复用
        // 避免因复用导致的内部状态损坏问题
        if (this.currentEditor && this.currentEditor.destroy) {
            try {
                this.currentEditor.destroy();
            } catch (e) {
                console.error('销毁编辑器失败:', e);
            }
            this.currentEditor = null;
        }

        // 创建新编辑器
        const adapter = this.adapters[type];
        this.currentEditor = await adapter.create(container, content, options);
        this.currentEditor.adapterName = type;

        return this.currentEditor;
    },

    // 获取当前编辑器
    getCurrentEditor() {
        return this.currentEditor;
    },

    // 获取当前编辑器类型
    getCurrentType() {
        return this.currentType;
    }
};

// 导出
window.EditorAdapterManager = EditorAdapterManager;
