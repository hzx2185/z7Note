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
        } else if (type === 'cut') {
            try {
                console.log('[剪切] 开始剪切操作');
                const text = ui.editor.getSelection ? ui.editor.getSelection() : ui.editor.value || '';
                console.log('[剪切] 选中的文本:', text);

                if (text) {
                    // 先复制到剪贴板
                    await navigator.clipboard.writeText(text);
                    console.log('[剪切] 已复制到剪贴板');

                    // 删除选中的文本 - 使用 CodeMirror 原生方法
                    if (ui.editor._editor && ui.editor._editor.replaceSelection) {
                        // 使用 CodeMirror 原生实例
                        console.log('[剪切] 使用 CodeMirror 原生 replaceSelection');
                        ui.editor._editor.replaceSelection('');
                    } else if (ui.editor.replaceSelection) {
                        // 使用适配器方法
                        console.log('[剪切] 使用适配器 replaceSelection');
                        ui.editor.replaceSelection('');
                    } else if (ui.editor.selectionStart !== undefined) {
                        // 普通 textarea
                        console.log('[剪切] 使用 textarea 方法');
                        const fullText = ui.editor.getValue ? ui.editor.getValue() : ui.editor.value || '';
                        const start = ui.editor.selectionStart || 0;
                        const end = ui.editor.selectionEnd || 0;
                        const newContent = fullText.substring(0, start) + fullText.substring(end);
                        console.log('[剪切] 删除位置:', start, '到', end);
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
                    console.log('[剪切] 剪切完成');
                    ui.showToast("已剪切");
                } else {
                    console.log('[剪切] 未选择内容');
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

                        // 检查是否包含斜杠（分类分隔符）
                        if (cleanLine.includes('/')) {
                            const parts = cleanLine.split('/');
                            const category = parts[0].replace(/^#+\s*/, '').trim();
                            const title = parts.slice(1).join('/').trim() || '未命名';
                            newTitle = `${category}/${title.substring(0, 80)}`;
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
        if (!res.ok) throw new Error('加载配置失败');
        const config = await res.json();

        // 填充表单
        document.getElementById('backup-enabled').checked = config.enabled;
        document.getElementById('backup-schedule').value = config.schedule || '0 20 * * *';
        document.getElementById('backup-webdav-url').value = config.webdavUrl || '';
        document.getElementById('backup-webdav-username').value = config.webdavUsername || '';
        document.getElementById('backup-webdav-password').value = config.webdavPassword || '';
        document.getElementById('backup-include-attachments').checked = config.includeAttachments;
        document.getElementById('backup-send-email').checked = config.sendEmail;
        document.getElementById('backup-email-address').value = config.emailAddress || '';
    } catch (e) {
        console.error('加载备份配置失败:', e);
        ui.showToast('加载配置失败', false);
    }
}

// 保存备份配置
async function saveBackupConfig(event) {
    event.preventDefault();

    const config = {
        enabled: document.getElementById('backup-enabled').checked,
        schedule: document.getElementById('backup-schedule').value,
        webdavUrl: document.getElementById('backup-webdav-url').value,
        webdavUsername: document.getElementById('backup-webdav-username').value,
        webdavPassword: document.getElementById('backup-webdav-password').value,
        includeAttachments: document.getElementById('backup-include-attachments').checked,
        sendEmail: document.getElementById('backup-send-email').checked,
        emailAddress: document.getElementById('backup-email-address').value
    };

    // 验证必填字段
    if (config.enabled) {
        if (!config.webdavUrl || !config.webdavUsername || !config.webdavPassword) {
            ui.showToast('请填写完整的 WebDAV 配置', false);
            return;
        }
    }

    if (config.sendEmail && !config.emailAddress) {
        ui.showToast('请填写邮箱地址', false);
        return;
    }

    try {
        const res = await fetch('/api/user/backup/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        if (!res.ok) throw new Error('保存失败');

        ui.showToast('配置已保存');
        document.getElementById('backup-modal').classList.remove('show');
    } catch (e) {
        console.error('保存备份配置失败:', e);
        ui.showToast('保存失败', false);
    }
}

// 立即备份
async function backupNow() {
    const config = {
        webdavUrl: document.getElementById('backup-webdav-url').value,
        webdavUsername: document.getElementById('backup-webdav-username').value,
        webdavPassword: document.getElementById('backup-webdav-password').value,
        includeAttachments: document.getElementById('backup-include-attachments').checked,
        sendEmail: document.getElementById('backup-send-email').checked,
        emailAddress: document.getElementById('backup-email-address').value
    };

    if (!config.webdavUrl || !config.webdavUsername || !config.webdavPassword) {
        ui.showToast('请先配置 WebDAV 信息', false);
        return;
    }

    try {
        ui.showToast('正在备份...', true);

        const res = await fetch('/api/user/backup/now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '备份失败');
        }

        const result = await res.json();
        ui.showToast(`备份成功！${result.fileCount} 个文件`);
    } catch (e) {
        console.error('备份失败:', e);
        ui.showToast(e.message || '备份失败', false);
    }
}
