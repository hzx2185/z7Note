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
    // 编辑器操作 - 使用适配器接口
    async editorAction(type) {
        if (!ui.editor) return;

        if (type === 'copy') {
            try {
                const text = ui.editor.getSelection ? ui.editor.getSelection() : ui.editor.value || '';
                await navigator.clipboard.writeText(text);
                ui.showToast("已复制");
            } catch (e) {
                ui.showToast("复制失败", false);
            }
        }         else if (type === 'cut') {
            try {
                const text = ui.editor.getSelection ? ui.editor.getSelection() : ui.editor.value || '';

                if (text) {
                    // 先复制到剪贴板
                    await navigator.clipboard.writeText(text);

                    // 删除选中的文本 - 使用 CodeMirror 原生方法
                    if (ui.editor._editor && ui.editor._editor.replaceSelection) {
                        // 使用 CodeMirror 原生实例
                        ui.editor._editor.replaceSelection('');
                    } else if (ui.editor.replaceSelection) {
                        // 使用适配器方法
                        ui.editor.replaceSelection('');
                    } else if (ui.editor.selectionStart !== undefined) {
                        // 普通 textarea
                        const fullText = ui.editor.getValue ? ui.editor.getValue() : ui.editor.value || '';
                        const start = ui.editor.selectionStart || 0;
                        const end = ui.editor.selectionEnd || 0;
                        const newContent = fullText.substring(0, start) + fullText.substring(end);
                        if (ui.editor.setValue) {
                            ui.editor.setValue(newContent);
                        } else {
                            ui.editor.value = newContent;
                        }
                        if (ui.editor.setSelection) {
                            ui.editor.setSelection(start, start);
                        } else {
                            ui.editor.selectionStart = ui.editor.selectionEnd = start;
                        }
                    }

                    ui.editor.focus();
                    ui.save();
                    ui.updatePreview();
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
                // 方案1：现代 Clipboard API
                if (navigator.clipboard && navigator.clipboard.readText) {
                    try {
                        const text = await navigator.clipboard.readText();
                        if (text) {
                            // 根据编辑器类型执行粘贴
                            if (ui.editor.executeEdits) {
                                // 使用 CodeMirror 适配器的 executeEdits 方法
                                ui.editor.executeEdits('paste', [{ text: text }]);
                            } else if (ui.editor.replaceRange) {
                                // 直接使用 CodeMirror 的 replaceRange
                                const cursor = ui.editor.getCursor ? ui.editor.getCursor() : { ch: 0, line: 0 };
                                ui.editor.replaceRange(text, cursor);
                            } else if (ui.editor.selectionStart !== undefined) {
                                // 普通 textarea - 使用 getValue 而不是 value
                                const fullText = ui.editor.getValue ? ui.editor.getValue() : ui.editor.value || '';
                                const start = ui.editor.selectionStart || 0;
                                const end = ui.editor.selectionEnd || 0;
                                const newContent = fullText.substring(0, start) + text + fullText.substring(end);
                                if (ui.editor.setValue) {
                                    ui.editor.setValue(newContent);
                                } else {
                                    ui.editor.value = newContent;
                                }
                                if (ui.editor.setSelection) {
                                    ui.editor.setSelection(start + text.length, start + text.length);
                                } else {
                                    ui.editor.selectionStart = ui.editor.selectionEnd = start + text.length;
                                }
                            } else if (ui.editor.setValue) {
                                // 其他编辑器类型 - 追加到末尾
                                const currentText = ui.editor.getValue ? ui.editor.getValue() : '';
                                ui.editor.setValue(currentText + text);
                            }
                            ui.editor.focus();
                            ui.save();
                            ui.updatePreview();
                            ui.showToast("已粘贴");
                        } else {
                            ui.showToast("剪贴板为空", false);
                        }
                        return;
                    } catch (e) {
                        // 忽略 Clipboard API 错误，继续尝试方案2
                    }

                }

                // 方案2：使用 input 元素触发粘贴
                const input = document.createElement('input');
                input.type = 'text';
                input.style.position = 'fixed';
                input.style.top = '-100px';
                input.style.left = '-100px';
                input.style.width = '20px';
                input.style.height = '20px';
                input.style.opacity = '0';
                input.style.pointerEvents = 'none';
                document.body.appendChild(input);

                try {
                    // 聚焦并选择输入框
                    input.focus();
                    input.select();

                    // 等待一小段时间让浏览器响应
                    await new Promise(resolve => setTimeout(resolve, 200));

                    // 尝试执行粘贴命令
                    const success = document.execCommand('paste');
                    const pastedText = input.value;

                    if (success && pastedText) {
                        // 根据编辑器类型执行粘贴
                        if (ui.editor.executeEdits) {
                            // 使用 CodeMirror 适配器的 executeEdits 方法
                            ui.editor.executeEdits('paste', [{ text: pastedText }]);
                        } else if (ui.editor.replaceRange) {
                            // 直接使用 CodeMirror 的 replaceRange
                            const cursor = ui.editor.getCursor ? ui.editor.getCursor() : { ch: 0, line: 0 };
                            ui.editor.replaceRange(pastedText, cursor);
                        } else if (ui.editor.selectionStart !== undefined) {
                            // 普通 textarea - 使用 getValue 而不是 value
                            const fullText = ui.editor.getValue ? ui.editor.getValue() : ui.editor.value || '';
                            const start = ui.editor.selectionStart || 0;
                            const end = ui.editor.selectionEnd || 0;
                            const newContent = fullText.substring(0, start) + pastedText + fullText.substring(end);
                            if (ui.editor.setValue) {
                                ui.editor.setValue(newContent);
                            } else {
                                ui.editor.value = newContent;
                            }
                            if (ui.editor.setSelection) {
                                ui.editor.setSelection(start + pastedText.length, start + pastedText.length);
                            } else {
                                ui.editor.selectionStart = ui.editor.selectionEnd = start + pastedText.length;
                            }
                        } else if (ui.editor.setValue) {
                            // 其他编辑器类型 - 追加到末尾
                            const currentText = ui.editor.getValue ? ui.editor.getValue() : '';
                            ui.editor.setValue(currentText + pastedText);
                        }
                        ui.editor.focus();
                        ui.save();
                        ui.updatePreview();
                        ui.showToast("已粘贴");
                    } else {
                        // 所有方案都失败，显示最终提示
                        ui.showToast("粘贴失败，请长按编辑器区域并选择粘贴", false);
                    }
                } catch (execError) {
                    ui.showToast("粘贴失败，请长按编辑器区域并选择粘贴", false);
                } finally {
                    if (document.body.contains(input)) {
                        document.body.removeChild(input);
                    }
                }
            } catch (e) {
                console.error('粘贴操作失败:', e);
                ui.showToast("粘贴失败，请长按编辑器区域并选择粘贴", false);
            }
        } else if (type === 'selectAll') {
            if (ui.editor.select) {
                ui.editor.select();
            } else if (ui.editor.execCommand) {
                ui.editor.execCommand('selectAll');
            }
            ui.editor.focus();
        } else if (type === 'selectLine') {
            // 选择当前整行
            try {
                // 获取当前光标位置
                const cursor = ui.editor.getPosition ? ui.editor.getPosition() : { line: 0, ch: 0 };
                const line = cursor.line || 0;
                
                // 获取当前行内容长度
                let lineLength = 0;
                if (ui.editor.getValue) {
                    const fullText = ui.editor.getValue();
                    const lines = fullText.split('\n');
                    if (lines[line]) {
                        lineLength = lines[line].length;
                    }
                } else if (ui.editor.getLine) {
                    lineLength = ui.editor.getLine(line).length;
                }
                
                // 使用 setSelection 方法（需要索引）
                if (ui.editor.setSelection && ui.editor.getCursorPos) {
                    // 获取行的开始索引（行号 × 假设每行平均长度 + 当前行内的偏移）
                    // 更准确的方式：使用 indexFromPos
                    const startIndex = ui.editor.getCursorPos ? ui.editor.getCursorPos() : 0;
                    // 计算行的开始索引
                    const lineStartIndex = ui.editor.getCursorPos();
                    // 计算当前行的偏移量
                    const currentLineOffset = cursor.ch || 0;
                    const finalStartIndex = lineStartIndex - currentLineOffset;
                    const finalEndIndex = finalStartIndex + lineLength;
                    
                    ui.editor.setSelection(finalStartIndex, finalEndIndex);
                } else if (ui.editor.setSelection) {
                    // 如果没有 getCursorPos，尝试直接使用适配器的 setSelection
                    // 适配器的 setSelection 期望索引，但这里我们需要计算
                    const fullText = ui.editor.getValue ? ui.editor.getValue() : '';
                    const lines = fullText.split('\n');
                    let offset = 0;
                    for (let i = 0; i < line; i++) {
                        offset += (lines[i] || '').length + 1; // +1 是换行符
                    }
                    ui.editor.setSelection(offset, offset + lineLength);
                } else if (ui.editor.setSelectionRange) {
                    ui.editor.setSelectionRange(line, line + lineLength);
                }
            } catch (e) {
                // 忽略选择行失败
            }
            ui.editor.focus();
        }
    },

    // 移动光标 - 使用适配器接口
    moveCursor(dir) {
        if (!ui.editor) return;

        // 获取当前光标位置
        const cursor = ui.editor.getPosition ? ui.editor.getPosition() : { line: 0, ch: 0 };
        const line = cursor.line || 0;
        const ch = cursor.ch || 0;

        // 获取当前行内容
        let lineLength = 0;
        if (ui.editor.getValue) {
            const fullText = ui.editor.getValue();
            const lines = fullText.split('\n');
            if (lines[line]) {
                lineLength = lines[line].length;
            }
        }

        let newPos = { line: line, ch: ch };

        if (dir === 'left') {
            if (ch > 0) {
                newPos.ch = ch - 1;
            } else if (line > 0) {
                // 移动到上一行末尾
                if (ui.editor.getValue) {
                    const fullText = ui.editor.getValue();
                    const lines = fullText.split('\n');
                    if (lines[line - 1]) {
                        newPos.line = line - 1;
                        newPos.ch = lines[line - 1].length;
                    }
                } else {
                    newPos.line = line - 1;
                    newPos.ch = 0;
                }
            }
        } else if (dir === 'right') {
            if (ch < lineLength) {
                newPos.ch = ch + 1;
            } else {
                // 移动到下一行开头
                if (ui.editor.getValue) {
                    const fullText = ui.editor.getValue();
                    const lines = fullText.split('\n');
                    if (lines[line + 1] !== undefined) {
                        newPos.line = line + 1;
                        newPos.ch = 0;
                    }
                } else {
                    newPos.line = line + 1;
                    newPos.ch = 0;
                }
            }
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
    },

    // 插入符号 - 使用适配器接口
    insertSymbol(before, after = "") {
        if (!ui.editor) return;

        const b = before.replace(/\\n/g, '\n');
        const a = after.replace(/\\n/g, '\n');
        const selText = ui.editor.getSelection ? ui.editor.getSelection() : '';

        // 获取当前光标位置
        const cursor = ui.editor.getPosition ? ui.editor.getPosition() : { line: 0, ch: 0 };
        const line = cursor.line || 0;
        const ch = cursor.ch || 0;

        // 组合插入文本
        const insertText = b + selText + a;

        // 使用 executeEdits 方法插入
        if (ui.editor.executeEdits) {
            ui.editor.executeEdits('insertSymbol', [{ text: insertText }]);
        } else if (ui.editor.replaceSelection) {
            // 如果有 replaceSelection 方法
            ui.editor.replaceSelection(insertText);
        } else if (ui.editor.setValue && ui.editor.getValue) {
            // 回退方案：直接操作文本
            const fullText = ui.editor.getValue();
            const lines = fullText.split('\n');
            let offset = 0;
            for (let i = 0; i < line; i++) {
                offset += (lines[i] || '').length + 1;
            }
            offset += ch;
            const newText = fullText.substring(0, offset) + insertText + fullText.substring(offset);
            ui.editor.setValue(newText);
        }

        // 计算并设置新光标位置
        const newCh = ch + b.length + selText.length;
        if (ui.editor.setPosition) {
            ui.editor.setPosition({ line: line, ch: newCh });
        } else if (ui.editor.setSelection) {
            const fullText = ui.editor.getValue ? ui.editor.getValue() : '';
            const lines = fullText.split('\n');
            let offset = 0;
            for (let i = 0; i < line; i++) {
                offset += (lines[i] || '').length + 1;
            }
            offset += newCh;
            ui.editor.setSelection(offset, offset);
        }

        ui.editor.focus();
        ui.save();
        ui.updatePreview();
    },

    // 插入待办事项 - 使用适配器接口
    insertTodo(completed = false) {
        if (!ui.editor) return;

        const checkbox = completed ? '- [x] ' : '- [ ] ';
        const selText = ui.editor.getSelection ? ui.editor.getSelection() : '';

        // 获取当前光标位置
        const cursor = ui.editor.getPosition ? ui.editor.getPosition() : { line: 0, ch: 0 };
        const line = cursor.line || 0;
        const ch = cursor.ch || 0;

        // 组合插入文本
        const insertText = checkbox + selText;

        // 使用 executeEdits 方法插入
        if (ui.editor.executeEdits) {
            ui.editor.executeEdits('insertTodo', [{ text: insertText }]);
        } else if (ui.editor.replaceSelection) {
            // 如果有 replaceSelection 方法
            ui.editor.replaceSelection(insertText);
        } else if (ui.editor.setValue && ui.editor.getValue) {
            // 回退方案：直接操作文本
            const fullText = ui.editor.getValue();
            const lines = fullText.split('\n');
            let offset = 0;
            for (let i = 0; i < line; i++) {
                offset += (lines[i] || '').length + 1;
            }
            offset += ch;
            const newText = fullText.substring(0, offset) + insertText + fullText.substring(offset);
            ui.editor.setValue(newText);
        }

        // 计算并设置新光标位置（在待办事项文本末尾）
        const newCh = ch + checkbox.length + selText.length;
        if (ui.editor.setPosition) {
            ui.editor.setPosition({ line: line, ch: newCh });
        } else if (ui.editor.setSelection) {
            const fullText = ui.editor.getValue ? ui.editor.getValue() : '';
            const lines = fullText.split('\n');
            let offset = 0;
            for (let i = 0; i < line; i++) {
                offset += (lines[i] || '').length + 1;
            }
            offset += newCh;
            ui.editor.setSelection(offset, offset);
        }

        ui.editor.focus();
        ui.save();
        ui.updatePreview();
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
        const now = Date.now();

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
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const imported = JSON.parse(ev.target.result);
                const items = Array.isArray(imported) ? imported : [imported];
                let newNotes = [...ui.notes];
                items.forEach(item => {
                    if (!item.content) return;
                    newNotes.unshift({
                        ...item,
                        id: Date.now().toString() + Math.random(),
                        isUnsynced: true,
                        deleted: false
                    });
                });
                ui.notes = newNotes;

                // 保存到云端
                for (const note of newNotes) {
                    if (note.isUnsynced) {
                        await ui.saveToCloud(note);
                    }
                }

                ui.render();
                ui.showToast("导入成功");
            } catch (err) {
                ui.showToast("格式错误", false);
            }
        };
        reader.readAsText(file);
    }
};

// 导出
window.tools = ToolsManager;

// ==================== 备份配置相关函数 ====================

// 加载备份配置
async function loadBackupConfig() {
    try {
        const res = await fetch('/api/user/backup/config');

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || '加载配置失败');
        }

        const config = await res.json();

        // 填充表单
        const modal = document.getElementById('backup-modal');
        if (!modal) {
            return;
        }

        // 检查所有必需的表单元素
        const elements = {
            'backup-enabled': { type: 'checkbox', value: config.enabled },
            'backup-schedule': { type: 'value', value: config.schedule || '0 20 * * *' },
            'backup-webdav-url': { type: 'value', value: config.webdavUrl || '' },
            'backup-webdav-username': { type: 'value', value: config.webdavUsername || '' },
            'backup-webdav-password': { type: 'value', value: config.webdavPassword || '' },
            'backup-include-attachments': { type: 'checkbox', value: config.includeAttachments },
            'backup-include-calendar': { type: 'checkbox', value: config.includeCalendar },
            'backup-include-todos': { type: 'checkbox', value: config.includeTodos },
            'backup-include-contacts': { type: 'checkbox', value: config.includeContacts },
            'backup-include-reminders': { type: 'checkbox', value: config.includeReminders },
            'backup-send-email': { type: 'checkbox', value: config.sendEmail },
            'backup-email-address': { type: 'value', value: config.emailAddress || '' }
        };

        for (const [id, elementConfig] of Object.entries(elements)) {
            const el = document.getElementById(id);
            if (!el) continue;

            if (elementConfig.type === 'checkbox') {
                el.checked = Boolean(elementConfig.value);
            } else {
                el.value = elementConfig.value;
            }
        }

        // 显示最后备份时间（如果有）
        const statusEl = document.getElementById('backup-status-text');
        if (statusEl) {
            if (config.lastBackupTime && config.lastBackupTime > 0) {
                const lastBackupDate = new Date(config.lastBackupTime);
                const formattedTime = lastBackupDate.toLocaleString('zh-CN');

                // 计算距离现在的时间
                const now = Date.now();
                const diff = now - config.lastBackupTime;
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const days = Math.floor(hours / 24);

                let timeText = '';
                if (days > 0) {
                    timeText = `${days}天前`;
                } else if (hours > 0) {
                    timeText = `${hours}小时前`;
                } else {
                    timeText = '刚刚';
                }

                statusEl.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;">
                    <span>上次备份: <strong>${formattedTime}</strong></span>
                    <span style="color:var(--accent);font-size:11px;">${timeText}</span>
                </div>`;
                statusEl.style.display = 'block';
                statusEl.style.background = config.enabled ? 'rgba(34, 197, 94, 0.1)' : 'var(--side)';
                statusEl.style.color = config.enabled ? 'var(--green)' : 'var(--gray)';
            } else if (config.enabled) {
                statusEl.innerHTML = '<span>暂未备份过数据</span>';
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(234, 179, 8, 0.1)';
                statusEl.style.color = 'var(--orange)';
            } else {
                statusEl.style.display = 'none';
            }
        }
    } catch (e) {
        ui.showToast('加载配置失败: ' + e.message, false);
    }
}

// 保存备份配置
async function saveBackupConfig(event) {
    event.preventDefault();

    // 检查 ui 对象是否存在
    if (!window.ui) {
        alert('UI 对象未初始化，请刷新页面重试');
        return;
    }


    // 获取表单元素
    const enabledEl = document.getElementById('backup-enabled');
    const scheduleEl = document.getElementById('backup-schedule');
    const webdavUrlEl = document.getElementById('backup-webdav-url');
    const webdavUsernameEl = document.getElementById('backup-webdav-username');
    const webdavPasswordEl = document.getElementById('backup-webdav-password');
    const includeAttachmentsEl = document.getElementById('backup-include-attachments');
    const includeCalendarEl = document.getElementById('backup-include-calendar');
    const includeTodosEl = document.getElementById('backup-include-todos');
    const includeContactsEl = document.getElementById('backup-include-contacts');
    const includeRemindersEl = document.getElementById('backup-include-reminders');
    const sendEmailEl = document.getElementById('backup-send-email');
    const emailAddressEl = document.getElementById('backup-email-address');

    // 检查元素是否存在

    if (!enabledEl || !scheduleEl || !webdavUrlEl || !webdavUsernameEl ||
        !webdavPasswordEl || !includeAttachmentsEl || !includeCalendarEl ||
        !includeTodosEl || !includeContactsEl || !includeRemindersEl ||
        !sendEmailEl || !emailAddressEl) {
        ui.showToast('表单元素未找到', false);
        return;
    }

    const config = {
        enabled: enabledEl.checked,
        schedule: scheduleEl.value,
        webdavUrl: webdavUrlEl.value.trim(),
        webdavUsername: webdavUsernameEl.value.trim(),
        webdavPassword: webdavPasswordEl.value,
        includeAttachments: includeAttachmentsEl.checked,
        includeCalendar: includeCalendarEl.checked,
        includeTodos: includeTodosEl.checked,
        includeContacts: includeContactsEl.checked,
        includeReminders: includeRemindersEl.checked,
        sendEmail: sendEmailEl.checked,
        emailAddress: emailAddressEl.value.trim()
    };

    // 验证必填字段
    if (config.enabled) {
        if (!config.webdavUrl) {
            ui.showToast('请填写 WebDAV 地址', false);
            webdavUrlEl.focus();
            return;
        }
        if (!config.webdavUsername) {
            ui.showToast('请填写 WebDAV 用户名', false);
            webdavUsernameEl.focus();
            return;
        }
        if (!config.webdavPassword) {
            ui.showToast('请填写 WebDAV 密码', false);
            webdavPasswordEl.focus();
            return;
        }

        // 验证 WebDAV URL 格式
        try {
            new URL(config.webdavUrl);
        } catch (e) {
            ui.showToast('WebDAV 地址格式不正确', false);
            webdavUrlEl.focus();
            return;
        }
    }

    if (config.sendEmail && !config.emailAddress) {
        ui.showToast('请填写邮箱地址', false);
        emailAddressEl.focus();
        return;
    }

    // 验证邮箱格式（如果填写了）
    if (config.emailAddress) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(config.emailAddress)) {
            ui.showToast('邮箱地址格式不正确', false);
            emailAddressEl.focus();
            return;
        }
    }

    try {
        ui.updateStatus('working', '正在保存...');

        const res = await fetch('/api/user/backup/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        }).catch(err => {
            throw new Error('网络请求失败，请检查网络连接');
        });


        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || '保存失败');
        }

        const result = await res.json();

        ui.showToast('配置已保存');
        ui.updateStatus('success', '配置已保存');

        // 刷新配置显示
        setTimeout(async () => {
            await loadBackupConfig();
        }, 100);

        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
            const modal = document.getElementById('backup-modal');
            if (modal) modal.classList.remove('show');
        }, 1500);
    } catch (e) {
        ui.updateStatus('error', '保存失败');
        alert('保存失败: ' + e.message);
        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 2000);
    }
}

// 测试 WebDAV 连接
async function testWebDAVConnection() {
    try {
        const webdavUrl = document.getElementById('backup-webdav-url').value.trim();
        const webdavUsername = document.getElementById('backup-webdav-username').value.trim();
        const webdavPassword = document.getElementById('backup-webdav-password').value;

        if (!webdavUrl || !webdavUsername || !webdavPassword) {
            ui.showToast('请填写完整的 WebDAV 配置信息', false);
            return;
        }

        // 验证 URL 格式
        try {
            new URL(webdavUrl);
        } catch (e) {
            ui.showToast('WebDAV URL 格式不正确', false);
            return;
        }

        ui.updateStatus('working', '正在测试连接...');

        const res = await fetch('/api/user/backup/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                webdavUrl,
                webdavUsername,
                webdavPassword
            })
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({ error: '测试失败' }));
            throw new Error(error.error || '测试失败');
        }

        const result = await res.json();

        let message = 'WebDAV 连接成功！';
        if (result.details && result.details.hasBackupDir) {
            if (result.details.canCreateDirectory) {
                message = 'WebDAV 连接成功，可以正常备份';
            } else {
                message = 'WebDAV 连接成功，但无法自动创建目录。请在 WebDAV 中手动创建 /z7note-backups 目录';
            }
        } else {
            message = 'WebDAV 连接成功，但 /z7note-backups 目录不存在。请在 WebDAV 中手动创建该目录';
        }

        ui.updateStatus('success', '连接成功');
        ui.showToast(message);

        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 3000);
    } catch (e) {
        ui.updateStatus('error', '连接失败');
        alert('连接失败: ' + e.message);
        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 3000);
    }
}

// 立即备份
async function backupNow() {
    // 检查 ui 对象是否存在
    if (!window.ui) {
        alert('UI 对象未初始化，请刷新页面重试');
        return;
    }

    // 检查是否正在备份
    const backupButton = document.querySelector('button[onclick="backupNow()"]');
    if (backupButton && backupButton.disabled) {
        alert('备份正在进行中，请稍候...');
        return;
    }

    try {
        ui.updateStatus('working', '正在准备备份...');

        // 禁用备份按钮
        if (backupButton) {
            backupButton.disabled = true;
            backupButton.textContent = '备份中...';
        }

        // 从服务器获取保存的配置
        const configRes = await fetch('/api/user/backup/config');
        if (!configRes.ok) {
            const errorData = await configRes.json();
            throw new Error(errorData.error || '获取配置失败');
        }
        const savedConfig = await configRes.json();

        // 验证 WebDAV 配置
        if (!savedConfig.webdavUrl || !savedConfig.webdavUsername || !savedConfig.webdavPassword) {
            ui.showToast('请先配置 WebDAV 信息', false);
            ui.updateStatus('error', '配置缺失');
            setTimeout(() => ui.updateStatus('idle', '就绪'), 2000);
            return;
        }

        // 使用表单中的值（可能用户刚修改还未保存）作为覆盖
        const formOverrides = {
            webdavUrl: document.getElementById('backup-webdav-url').value,
            webdavUsername: document.getElementById('backup-webdav-username').value,
            webdavPassword: document.getElementById('backup-webdav-password').value,
            includeAttachments: document.getElementById('backup-include-attachments').checked,
            includeCalendar: document.getElementById('backup-include-calendar').checked,
            includeTodos: document.getElementById('backup-include-todos').checked,
            includeContacts: document.getElementById('backup-include-contacts').checked,
            includeReminders: document.getElementById('backup-include-reminders').checked,
            sendEmail: document.getElementById('backup-send-email').checked,
            emailAddress: document.getElementById('backup-email-address').value
        };

        // 如果表单中有值，使用表单值；否则使用保存的值
        const backupConfig = {
            webdavUrl: formOverrides.webdavUrl || savedConfig.webdavUrl,
            webdavUsername: formOverrides.webdavUsername || savedConfig.webdavUsername,
            webdavPassword: formOverrides.webdavPassword || savedConfig.webdavPassword,
            includeAttachments: formOverrides.includeAttachments !== undefined ? formOverrides.includeAttachments : savedConfig.includeAttachments,
            includeCalendar: formOverrides.includeCalendar !== undefined ? formOverrides.includeCalendar : savedConfig.includeCalendar,
            includeTodos: formOverrides.includeTodos !== undefined ? formOverrides.includeTodos : savedConfig.includeTodos,
            includeContacts: formOverrides.includeContacts !== undefined ? formOverrides.includeContacts : savedConfig.includeContacts,
            includeReminders: formOverrides.includeReminders !== undefined ? formOverrides.includeReminders : savedConfig.includeReminders,
            sendEmail: formOverrides.sendEmail !== undefined ? formOverrides.sendEmail : savedConfig.sendEmail,
            emailAddress: formOverrides.emailAddress || savedConfig.emailAddress
        };

        // 验证必填字段
        if (!backupConfig.webdavUrl || !backupConfig.webdavUsername || !backupConfig.webdavPassword) {
            ui.showToast('请先配置 WebDAV 信息', false);
            ui.updateStatus('error', '配置缺失');
            setTimeout(() => ui.updateStatus('idle', '就绪'), 2000);
            return;
        }

        ui.updateStatus('working', '正在导出数据...');

        const res = await fetch('/api/user/backup/now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backupConfig)
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({ error: '备份失败' }));

            // 提供更友好的错误提示
            let errorMessage = error.error || '备份失败';
            if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
                errorMessage += '。请检查 WebDAV 权限，或手动在 WebDAV 中创建 /z7note-backups 目录';
            } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
                errorMessage += '。请检查 WebDAV 用户名和密码';
            } else if (errorMessage.includes('今日已备份')) {
                // 恢复按钮状态
                if (backupButton) {
                    backupButton.disabled = false;
                    backupButton.textContent = '立即备份';
                }
            }

            throw new Error(errorMessage);
        }

        const result = await res.json();
        ui.updateStatus('success', '备份成功');
        ui.showToast(`备份成功！${result.fileCount} 个文件`);

        // 恢复备份按钮
        if (backupButton) {
            backupButton.disabled = false;
            backupButton.textContent = '立即备份';
        }

        // 刷新配置显示（备份时间可能已更新）
        await loadBackupConfig();

        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 3000);
    } catch (e) {
        console.error('备份失败:', e);
        ui.updateStatus('error', '备份失败');
        alert(e.message || '备份失败');

        // 恢复备份按钮
        if (backupButton) {
            backupButton.disabled = false;
            backupButton.textContent = '立即备份';
        }

        setTimeout(() => {
            ui.updateStatus('idle', '就绪');
        }, 3000);
    }
}

// 导出函数到全局 window 对象，供 HTML 中的事件处理器使用
window.saveBackupConfig = saveBackupConfig;
window.backupNow = backupNow;
window.loadBackupConfig = loadBackupConfig;
window.testWebDAVConnection = testWebDAVConnection;
