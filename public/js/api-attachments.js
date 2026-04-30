// 附件管理和审计相关 API
export function createAttachmentApi(fetchWithTimeout) {
    return {
    // 加载附件选择器
    async loadAttachmentsForPicker() {
        const modal = document.getElementById('attachment-picker-modal');
        const container = document.getElementById('attachment-picker-list');
        if (!modal || !container) {
            console.error('attachment picker modal or list not found');
            return;
        }
        modal.classList.add('show');
        container.innerHTML = '<div class="attachment-picker-state">加载中...</div>';
        try {
            const res = await fetchWithTimeout('/api/attachments');
            if (!res.ok) throw new Error('list fetch failed');
            const files = await res.json();

            // 缓存附件列表
            this.attachmentsCache = files || [];

            if (!files || files.length === 0) {
                container.innerHTML = '<div class="attachment-picker-state attachment-picker-state-muted">暂无附件</div>';
                return;
            }

            this.renderAttachmentPicker(files);
        } catch (e) {
            console.error('loadAttachmentsForPicker error', e);
            container.innerHTML = '<div class="attachment-picker-state attachment-picker-state-danger">加载失败</div>';
        }
    },

    // 渲染附件选择器
    renderAttachmentPicker(files) {
        const container = document.getElementById('attachment-picker-list');
        if (!container) return;

        container.innerHTML = files.map(f => {
            const name = f.name || f.filename || f;
            const rawUrl = `/api/attachments/raw/${encodeURIComponent(name)}`;
            const sizeText = f.size || '';
            const isImage = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
            const encodedName = encodeURIComponent(name);

            return `
                <div class="file-card" onclick="api.insertAttachmentToEditor('${encodedName}', ${isImage})">
                    <div class="file-preview">
                        ${isImage ? `<img src="${rawUrl}">` : `<span class="file-icon">📄</span>`}
                    </div>
                    <div class="file-name" title="${name}">${name}</div>
                    <div class="file-meta">${sizeText}</div>
                </div>
            `;
        }).join('');
    },

    // 筛选附件
    filterAttachmentsForPicker() {
        const searchInput = document.getElementById('attachment-picker-search');
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

        if (!searchTerm) {
            this.renderAttachmentPicker(this.attachmentsCache);
        } else {
            const filtered = this.attachmentsCache.filter(f => {
                const name = f.name || f.filename || f;
                return name.toLowerCase().includes(searchTerm);
            });
            this.renderAttachmentPicker(filtered);
        }
    },

    // 插入附件到编辑器
    insertAttachmentToEditor(filename, isImage) {
        const name = decodeURIComponent(filename);
        const rawUrl = `/api/attachments/raw/${encodeURIComponent(name)}`;

        // 关闭模态框
        const modal = document.getElementById('attachment-picker-modal');
        if (modal) modal.classList.remove('show');

        // 插入到编辑器
        if (!ui.editor) {
            ui.showToast("编辑器未就绪", false);
            return;
        }

        const tag = isImage ? `![${name}](${rawUrl})` : `[${name}](${rawUrl})`;

        // 获取正确的插入位置
        let insertIndex = 0;
        let selEnd = 0;

        if (ui.editor.getCursorPos) {
            // CodeMirror 适配器
            insertIndex = ui.editor.getCursorPos();
            // 获取选择结束位置，如果没有选择则等于插入位置
            selEnd = ui.editor.selectionEnd !== undefined ? ui.editor.selectionEnd : insertIndex;
            // 确保 selEnd 不小于 insertIndex
            if (selEnd < insertIndex) {
                selEnd = insertIndex;
            }
        } else if (ui.editor.selectionStart !== undefined) {
            // 普通 textarea
            insertIndex = ui.editor.selectionStart;
            selEnd = ui.editor.selectionEnd;
            // 确保 selEnd 不小于 insertIndex
            if (selEnd < insertIndex) {
                selEnd = insertIndex;
            }
        } else {
            // 文件末尾
            insertIndex = (ui.editor.getValue() || '').length;
            selEnd = insertIndex;
        }

        const fullText = ui.editor.getValue();
        const newContent = fullText.substring(0, insertIndex) + tag + fullText.substring(selEnd);
        ui.editor.setValue(newContent);

        // 设置光标到插入内容的末尾
        const newIndex = insertIndex + tag.length;
        if (ui.editor.setSelection) {
            ui.editor.setSelection(newIndex, newIndex);
        } else if (ui.editor.selectionStart !== undefined) {
            ui.editor.selectionStart = ui.editor.selectionEnd = newIndex;
        }
        ui.editor.focus();

        ui.save();
        ui.updatePreview();
        ui.showToast("已插入");
    },

    // 从附件管理器插入附件到编辑器
    insertAttachmentToEditorFromManager(filename, isImage) {
        const name = decodeURIComponent(filename);
        const rawUrl = `/api/attachments/raw/${encodeURIComponent(name)}`;

        // 关闭附件管理模态框
        const modal = document.getElementById('attachment-modal');
        if (modal) modal.classList.remove('show');

        // 插入到编辑器
        if (!ui.editor) {
            ui.showToast("编辑器未就绪", false);
            return;
        }

        const tag = isImage ? `![${name}](${rawUrl})` : `[${name}](${rawUrl})`;

        // 获取正确的插入位置
        let insertIndex = 0;
        let selEnd = 0;

        if (ui.editor.getCursorPos) {
            // CodeMirror 适配器
            insertIndex = ui.editor.getCursorPos();
            // 获取选择结束位置，如果没有选择则等于插入位置
            selEnd = ui.editor.selectionEnd !== undefined ? ui.editor.selectionEnd : insertIndex;
            // 确保 selEnd 不小于 insertIndex
            if (selEnd < insertIndex) {
                selEnd = insertIndex;
            }
        } else if (ui.editor.selectionStart !== undefined) {
            // 普通 textarea
            insertIndex = ui.editor.selectionStart;
            selEnd = ui.editor.selectionEnd;
            // 确保 selEnd 不小于 insertIndex
            if (selEnd < insertIndex) {
                selEnd = insertIndex;
            }
        } else {
            // 文件末尾
            insertIndex = (ui.editor.getValue() || '').length;
            selEnd = insertIndex;
        }

        const fullText = ui.editor.getValue();
        const newContent = fullText.substring(0, insertIndex) + tag + fullText.substring(selEnd);
        ui.editor.setValue(newContent);

        // 设置光标到插入内容的末尾
        const newIndex = insertIndex + tag.length;
        if (ui.editor.setSelection) {
            ui.editor.setSelection(newIndex, newIndex);
        } else if (ui.editor.selectionStart !== undefined) {
            ui.editor.selectionStart = ui.editor.selectionEnd = newIndex;
        }
        ui.editor.focus();

        ui.save();
        ui.updatePreview();
        ui.showToast("已插入");
    },

    // 复制附件链接
    async copyAttachmentLink(filename) {
        const name = decodeURIComponent(filename);
        const rawUrl = `${location.protocol}//${location.host}/api/attachments/raw/${encodeURIComponent(name)}`;
        try {
            await navigator.clipboard.writeText(rawUrl);
            ui.showToast("链接已复制到剪贴板");
        } catch (e) {
            ui.showToast("复制失败", false);
        }
    },
    // 加载附件列表 - 使用缓存避免重复请求
    async loadAttachments(forceRefresh = false) {
        const modal = document.getElementById('attachment-modal');
        if (!modal) return;
        modal.classList.add('show');

        // 如果有缓存且不强制刷新，直接使用缓存
        if (!forceRefresh && this.attachmentsCache.length > 0) {
            this.filteredAttachments = [...this.attachmentsCache];
            this.renderAttachments();
            return;
        }

        try {
            const res = await fetchWithTimeout('/api/attachments');
            if (!res.ok) throw new Error('list fetch failed');
            const files = await res.json();

            // 缓存附件列表
            this.attachmentsCache = files || [];
            this.filteredAttachments = [...this.attachmentsCache];
            this.attachmentCurrentPage = 1;

            // 渲染附件
            this.renderAttachments();
        } catch (e) {
            const container = document.getElementById('attachment-list');
            if (container) {
                container.innerHTML = '<div class="attachment-picker-state attachment-picker-state-danger">加载失败</div>';
            }
        }
    },

    // 渲染附件列表 - 优化版本
    renderAttachments() {
        const files = this.filteredAttachments;
        const container = document.getElementById('attachment-list');
        const listView = document.getElementById('attachment-list-view');
        const pagination = document.getElementById('attachment-pagination');
        const viewToggleBtn = document.getElementById('view-toggle-btn');

        if (!files || files.length === 0) {
            if (container) container.innerHTML = '<div class="attachment-picker-state attachment-picker-state-muted">暂无附件</div>';
            if (listView) listView.innerHTML = '<div class="attachment-picker-state attachment-picker-state-muted">暂无附件</div>';
            if (pagination) pagination.style.display = 'none';
            return;
        }

        // 分页计算
        const totalPages = Math.ceil(files.length / this.attachmentPageSize);
        const startIndex = (this.attachmentCurrentPage - 1) * this.attachmentPageSize;
        const endIndex = startIndex + this.attachmentPageSize;
        const pageFiles = files.slice(startIndex, endIndex);

        // 显示分页
        if (pagination) {
            if (totalPages > 1) {
                pagination.style.display = 'flex';
                pagination.innerHTML = `
                    <button class="tool-btn" onclick="api.goToPage(${this.attachmentCurrentPage - 1})" ${this.attachmentCurrentPage === 1 ? 'disabled' : ''}>上一页</button>
                    <span class="file-meta">${this.attachmentCurrentPage} / ${totalPages}</span>
                    <button class="tool-btn" onclick="api.goToPage(${this.attachmentCurrentPage + 1})" ${this.attachmentCurrentPage === totalPages ? 'disabled' : ''}>下一页</button>
                `;
            } else {
                pagination.style.display = 'none';
            }
        }

        // 更新视图切换按钮
        if (viewToggleBtn) {
            viewToggleBtn.textContent = this.attachmentViewMode === 'grid' ? '列表' : '卡片';
        }

        // 根据视图模式渲染
        if (this.attachmentViewMode === 'list') {
            if (container) container.style.display = 'none';
            if (listView) {
                listView.style.display = 'flex';
                listView.innerHTML = pageFiles.map(f => this.renderAttachmentListItem(f)).join('');
            }
        } else {
            if (listView) listView.style.display = 'none';
            if (container) {
                container.style.display = 'grid';
                container.innerHTML = pageFiles.map(f => this.renderAttachmentGridItem(f)).join('');
            }
        }
    },

    // 渲染网格视图项 - 简化版本，移除分享状态显示
    renderAttachmentGridItem(f) {
        const name = f.name || f.filename || f;
        const rawUrl = `/api/attachments/raw/${encodeURIComponent(name)}`;
        const sizeText = f.size || '';
        const timeText = this.formatAttachmentTime(f.time);
        const encodedName = encodeURIComponent(name);
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);

        // 检查是否为无效附件
        const isInvalid = this.invalidAttachmentsCache.some(inv => inv.name === name);
        const invalidBadge = isInvalid ? '<span class="badge badge-danger">无效</span>' : '';

        return `
            <div class="file-card ${isInvalid ? 'attachment-invalid' : ''}">
                <div class="file-preview">
                    ${isImage ? `<img src="${rawUrl}" loading="lazy">` : `<span class="file-icon">📄</span>`}
                </div>
                <div class="file-name" title="${name}" onclick="window.open('${rawUrl}', '_blank')">${name} ${invalidBadge}</div>
                <div class="file-meta-sm">${sizeText}</div>
                <div class="file-meta-sm">${timeText}</div>
                <div class="file-actions">
                    <button class="tool-btn tool-btn-share" onclick="api.shareAttachment('${encodedName}')" title="分享链接">分享</button>
                    <button class="tool-btn tool-btn-insert" onclick="api.insertAttachmentToEditorFromManager('${encodedName}', ${isImage})" title="插入">插入</button>
                    <button class="tool-btn" onclick="api.renameAttachment('${encodedName}')" title="重命名">重命名</button>
                    <button class="tool-btn btn-danger" onclick="api.deleteAttachment('${encodedName}')" title="删除">删除</button>
                </div>
            </div>
        `;
    },

    // 渲染列表视图项 - 简化版本
    renderAttachmentListItem(f) {
        const name = f.name || f.filename || f;
        const rawUrl = `/api/attachments/raw/${encodeURIComponent(name)}`;
        const sizeText = f.size || '';
        const timeText = this.formatAttachmentTime(f.time);
        const encodedName = encodeURIComponent(name);
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);

        // 检查是否为无效附件
        const isInvalid = this.invalidAttachmentsCache.some(inv => inv.name === name);
        const invalidBadge = isInvalid ? '<span class="badge badge-danger badge-inline-offset">无效</span>' : '';

        return `
            <div class="attachment-list-item ${isInvalid ? 'attachment-invalid-list' : ''}">
                <div class="file-preview">
                    ${isImage ? `<img src="${rawUrl}" loading="lazy">` : `<span class="file-icon-sm">📄</span>`}
                </div>
                <div class="file-name" onclick="window.open('${rawUrl}', '_blank')" title="${name}">${name} ${invalidBadge}</div>
                <div class="file-meta-sm file-meta-shrink">${sizeText}</div>
                <div class="file-meta-sm file-meta-shrink file-time-meta" title="${timeText}">${timeText}</div>
                <div class="file-actions">
                    <button class="tool-btn tool-btn-share" onclick="api.shareAttachment('${encodedName}')" title="分享链接">分享</button>
                    <button class="tool-btn tool-btn-insert" onclick="api.insertAttachmentToEditorFromManager('${encodedName}', ${isImage})" title="插入">插入</button>
                    <button class="tool-btn" onclick="api.renameAttachment('${encodedName}')" title="重命名">重命名</button>
                    <button class="tool-btn btn-danger" onclick="api.deleteAttachment('${encodedName}')" title="删除">删除</button>
                </div>
            </div>
        `;
    },

    formatAttachmentTime(value) {
        if (!value) return '时间未知';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '时间未知';
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    normalizeTimestamp(value) {
        const raw = Number(value);
        if (!Number.isFinite(raw) || raw <= 0) return null;
        return raw > 10000000000 ? raw : raw * 1000;
    },

    formatDate(value) {
        const ts = this.normalizeTimestamp(value);
        if (!ts) return '-';
        const date = new Date(ts);
        return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('zh-CN');
    },

    // 切换附件视图
    toggleAttachmentView() {
        this.attachmentViewMode = this.attachmentViewMode === 'grid' ? 'list' : 'grid';
        this.loadAttachments();
    },

    // 筛选附件
    filterAttachments() {
        const searchInput = document.getElementById('attachment-search');
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

        if (!searchTerm) {
            this.filteredAttachments = [...this.attachmentsCache];
        } else {
            this.filteredAttachments = this.attachmentsCache.filter(f => {
                const name = f.name || f.filename || f;
                return name.toLowerCase().includes(searchTerm);
            });
        }

        this.attachmentCurrentPage = 1;
        this.renderAttachments();
    },

    // 分页跳转
    goToPage(page) {
        const totalPages = Math.ceil(this.filteredAttachments.length / this.attachmentPageSize);
        if (page < 1 || page > totalPages) return;
        this.attachmentCurrentPage = page;
        this.renderAttachments();
    },

    // 删除附件
    async deleteAttachment(filename) {
        const decoded = decodeURIComponent(filename);
        if (!confirm(`确定彻底删除文件: ${decoded} ？`)) return;
        try {
            const res = await fetchWithTimeout(`/api/attachments/${encodeURIComponent(decoded)}`, { method: 'DELETE' });
            if (res.ok) {
                ui.showToast("已删除");
                await this.loadAttachments(true); // 强制刷新
                if (ui.loadUserInfo) {
                    await ui.loadUserInfo();
                } else {
                    ui.refreshUserInfo();
                }
            }
        } catch (e) {
            ui.showToast("删除失败", false);
        }
    },

    // 重命名附件
    async renameAttachment(filename) {
        const oldName = decodeURIComponent(filename);
        const newName = prompt("请输入新的文件名:", oldName);





        if (!newName || newName.trim() === '') {
            return; // 用户取消或输入为空
        }

        if (newName === oldName) {
            ui.showToast("文件名未改变");
            return;
        }

        try {
            const res = await fetchWithTimeout(`/api/attachments/${encodeURIComponent(oldName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newName: newName.trim() })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || '重命名失败');
            }

            ui.showToast("重命名成功");
            this.loadAttachments();

            // 自动更新笔记中的引用

            await this.updateAttachmentReferences(oldName, newName.trim());

        } catch (e) {
            console.error('renameAttachment error:', e);
            ui.showToast(e.message || "重命名失败", false);
        }
    },

    // 更新笔记中附件的引用
    async updateAttachmentReferences(oldName, newName) {




        try {
            const notes = ui.notes || [];

            let updatedCount = 0;

            // 获取当前用户名
            const currentUser = localStorage.getItem('username') || '';

            // 新文件的引用格式
            const newUrl = `/api/attachments/raw/${encodeURIComponent(newName)}`;

            for (const note of notes) {
                if (!note.content || note.deleted) continue;

                let content = note.content;
                let hasUpdate = false;

                // 使用正则表达式匹配各种可能的引用格式
                // 匹配格式：![alt](url) 或 [text](url)
                const markdownLinkRegex = /(!\[([^\]]*)\]|\[([^\]]+)\])\(([^)]+)\)/g;

                const matches = [];
                content.replace(markdownLinkRegex, (match, prefix, alt1, text, url) => {
                    matches.push({ match, prefix, url });
                    return match;
                });

                content = content.replace(markdownLinkRegex, (match, prefix, alt1, text, url) => {
                    // 检查 URL 中是否包含旧文件名
                    if (url.includes(oldName)) {
                        // 替换为新 URL
                        const newPrefix = prefix.startsWith('!') ? `![${newName}]` : `[${newName}]`;

                        return `${newPrefix}(${newUrl})`;
                    }
                    return match;
                });

                // 检查是否有变化
                if (content !== note.content) {
                    note.content = content;
                    note.updatedAt = Math.floor(Date.now() / 1000);
                    note.isUnsynced = true;
                    updatedCount++;

                }
            }

            if (updatedCount > 0) {
                // 保存到云端
                for (const note of notes) {
                    if (note.isUnsynced) {
                        await ui.saveToCloud(note);
                    }
                }

                ui.render();

                // 记录被更新的笔记 ID
                const updatedNoteIds = notes.filter(n => n.isUnsynced).map(n => n.id.toString());

                // 如果当前打开的笔记被更新了，刷新编辑器
                if (ui.activeId && updatedNoteIds.includes(ui.activeId.toString())) {
                    const currentNote = notes.find(n => n.id.toString() === ui.activeId.toString());
                    if (currentNote) {
                        // 直接更新编辑器内容
                        if (ui.editor && ui.editor.setValue) {
                            ui.editor.setValue(currentNote.content);
                            ui.updatePreview();
                        }
                    }
                }

                ui.showToast(`已更新 ${updatedCount} 篇笔记中的引用`);
            }
        } catch (e) {
            console.error('updateAttachmentReferences error:', e);
        }
    }
    };
}
