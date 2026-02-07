// API 调用模块
import { fetchWithTimeout } from './utils.js';

const APIManager = {
    // 存储附件列表用于筛选
    attachmentsCache: [],
    // 附件管理视图模式: 'grid' 或 'list'
    attachmentViewMode: 'grid',
    // 分页设置
    attachmentPageSize: 20,
    attachmentCurrentPage: 1,
    // 筛选后的附件列表
    filteredAttachments: [],
    // 无效附件缓存
    invalidAttachmentsCache: [],
    // 引用异常的笔记缓存
    notesWithInvalidAttachments: [],

    // 加载附件选择器
    async loadAttachmentsForPicker() {
        const modal = document.getElementById('attachment-picker-modal');
        const container = document.getElementById('attachment-picker-list');
        if (!modal || !container) {
            console.error('attachment picker modal or list not found');
            return;
        }
        modal.classList.add('show');
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;">加载中...</div>';
        try {
            const res = await fetchWithTimeout('/api/attachments');
            if (!res.ok) throw new Error('list fetch failed');
            const files = await res.json();

            // 缓存附件列表
            this.attachmentsCache = files || [];

            if (!files || files.length === 0) {
                container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--gray);">暂无附件</div>';
                return;
            }

            this.renderAttachmentPicker(files);
        } catch (e) {
            console.error('loadAttachmentsForPicker error', e);
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--red);">加载失败</div>';
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
                        ${isImage ? `<img src="${rawUrl}">` : `<span style="font-size:24px">📄</span>`}
                    </div>
                    <div class="file-name" title="${name}">${name}</div>
                    <div style="font-size:12px; color:var(--gray);">${sizeText}</div>
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
            selEnd = ui.editor.selectionEnd !== undefined ? ui.editor.selectionEnd : insertIndex;
        } else if (ui.editor.selectionStart !== undefined) {
            // 普通 textarea
            insertIndex = ui.editor.selectionStart;
            selEnd = ui.editor.selectionEnd;
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
            selEnd = ui.editor.selectionEnd !== undefined ? ui.editor.selectionEnd : insertIndex;
        } else if (ui.editor.selectionStart !== undefined) {
            // 普通 textarea
            insertIndex = ui.editor.selectionStart;
            selEnd = ui.editor.selectionEnd;
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
                container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--red);">加载失败</div>';
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
            if (container) container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--gray);">暂无附件</div>';
            if (listView) listView.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray);">暂无附件</div>';
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
                    <span style="font-size:12px;color:var(--gray);">${this.attachmentCurrentPage} / ${totalPages}</span>
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
        const encodedName = encodeURIComponent(name);
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
        
        // 检查是否为无效附件
        const isInvalid = this.invalidAttachmentsCache.some(inv => inv.name === name);
        const invalidStyle = isInvalid ? 'border: 2px solid var(--red); opacity: 0.7;' : '';
        const invalidBadge = isInvalid ? '<span class="badge" style="background:var(--red);color:white;">无效</span>' : '';

        return `
            <div class="file-card" style="${invalidStyle}">
                <div class="file-preview">
                    ${isImage ? `<img src="${rawUrl}" loading="lazy">` : `<span style="font-size:24px">📄</span>`}
                </div>
                <div class="file-name" title="${name}" onclick="window.open('${rawUrl}', '_blank')">${name} ${invalidBadge}</div>
                <div style="font-size:12px; color:var(--gray);">${sizeText}</div>
                <div class="file-actions" style="gap:2px;">
                    <button class="tool-btn" onclick="api.shareAttachment('${encodedName}')" title="分享链接" style="font-size:11px;padding:2px 6px;color:var(--green);">分享</button>
                    <button class="tool-btn" onclick="api.insertAttachmentToEditorFromManager('${encodedName}', ${isImage})" title="插入" style="font-size:11px;padding:2px 6px;color:var(--accent);">插入</button>
                    <button class="tool-btn" onclick="api.renameAttachment('${encodedName}')" title="重命名" style="font-size:11px;padding:2px 6px;">重命名</button>
                    <button class="tool-btn btn-danger" onclick="api.deleteAttachment('${encodedName}')" title="删除" style="font-size:11px;padding:2px 6px;">删除</button>
                </div>
            </div>
        `;
    },

    // 渲染列表视图项 - 简化版本
    renderAttachmentListItem(f) {
        const name = f.name || f.filename || f;
        const rawUrl = `/api/attachments/raw/${encodeURIComponent(name)}`;
        const sizeText = f.size || '';
        const encodedName = encodeURIComponent(name);
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);

        // 检查是否为无效附件
        const isInvalid = this.invalidAttachmentsCache.some(inv => inv.name === name);
        const invalidStyle = isInvalid ? 'border: 2px solid var(--red); opacity: 0.7;' : '';
        const invalidBadge = isInvalid ? '<span class="badge" style="background:var(--red);color:white;margin-left:4px;">无效</span>' : '';

        return `
            <div class="file-card attachment-list-item" style="${invalidStyle}">
                <div class="file-preview">
                    ${isImage ? `<img src="${rawUrl}" loading="lazy">` : `<span style="font-size:18px">📄</span>`}
                </div>
                <div class="file-name" onclick="window.open('${rawUrl}', '_blank')" title="${name}">${name} ${invalidBadge}</div>
                <div style="font-size:12px; color:var(--gray);flex-shrink:0;">${sizeText}</div>
                <div class="file-actions" style="gap:2px;">
                    <button class="tool-btn" onclick="api.shareAttachment('${encodedName}')" title="分享链接" style="font-size:11px;padding:2px 6px;color:var(--green);">分享</button>
                    <button class="tool-btn" onclick="api.insertAttachmentToEditorFromManager('${encodedName}', ${isImage})" title="插入" style="font-size:11px;padding:2px 6px;color:var(--accent);">插入</button>
                    <button class="tool-btn" onclick="api.renameAttachment('${encodedName}')" title="重命名" style="font-size:11px;padding:2px 6px;">重命名</button>
                    <button class="tool-btn btn-danger" onclick="api.deleteAttachment('${encodedName}')" title="删除" style="font-size:11px;padding:2px 6px;">删除</button>
                </div>
            </div>
        `;
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
                this.loadAttachments(true); // 强制刷新
                ui.refreshUserInfo();
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
                    note.updatedAt = Date.now();
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
    },

    // 查询未引用的附件
    async findUnreferencedAttachments() {
        ui.showToast("正在查询未引用附件...");
        
        try {
            // 获取所有附件
            const res = await fetchWithTimeout('/api/attachments');
            if (!res.ok) throw new Error('获取附件列表失败');
            const attachments = await res.json() || [];
            
            if (attachments.length === 0) {
                ui.showToast("暂无附件");
                return;
            }

            // 获取所有笔记
            const notes = ui.notes || [];
            const activeNotes = notes.filter(n => !n.deleted);
            
            // 收集所有被引用的附件文件名
            const referencedFiles = new Set();
            const attachmentRegex = /\/api\/attachments\/raw\/([^"')\s]+)/g;
            
            for (const note of activeNotes) {
                if (!note.content) continue;
                let match;
                while ((match = attachmentRegex.exec(note.content)) !== null) {
                    const filename = decodeURIComponent(match[1]);
                    referencedFiles.add(filename);
                }
            }
            
            // 找出未被引用的附件
            const unreferenced = [];
            for (const att of attachments) {
                const name = att.name || att.filename || att;
                if (!referencedFiles.has(name)) {
                    unreferenced.push({
                        name: name,
                        size: att.size || ''
                    });
                }
            }
            
            // 显示结果
            this.showUnreferencedAttachments(unreferenced);
            
        } catch (e) {
            console.error('[Attachment] 查询未引用附件失败:', e);
            ui.showToast("查询失败: " + e.message, false);
        }
    },
    
    // 显示未引用附件列表
    showUnreferencedAttachments(unreferenced) {
        const area = document.getElementById('unreferenced-attachments-area');
        const list = document.getElementById('unreferenced-list');
        const title = document.getElementById('unreferenced-title');
        
        if (!area || !list) {
            ui.showToast(`检测到 ${unreferenced.length} 个未引用附件`, unreferenced.length === 0);
            return;
        }
        
        if (unreferenced.length === 0) {
            title.textContent = '未引用附件列表 (0)';
            title.style.color = 'var(--green)';
            list.innerHTML = '<div style="text-align:center;padding:12px;color:var(--gray);font-size:12px;">所有附件都已被引用 ✅</div>';
        } else {
            title.textContent = `未引用附件列表 (${unreferenced.length})`;
            title.style.color = 'var(--orange)';
            list.innerHTML = unreferenced.map(att => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(128,128,128,0.2);">
                    <span style="font-size:12px;color:var(--text);" title="${att.name}">${att.name}</span>
                    <span style="font-size:11px;color:var(--gray);flex-shrink:0;">${att.size}</span>
                </div>
            `).join('');
        }
        
        area.style.display = 'block';
    },
    
    // 关闭未引用附件展示区域
    closeUnreferencedArea() {
        const area = document.getElementById('unreferenced-attachments-area');
        if (area) area.style.display = 'none';
    },

    // 清理未引用的附件
    async purgeAttachmentsInManager() {
        if (!confirm("确定清理未引用附件？这将删除所有未被笔记引用的附件。")) return;
        ui.showToast("正在扫描并清理...");
        try {
            const res = await fetchWithTimeout('/api/purge-attachments', { method: 'POST' });
            const data = await res.json();
            ui.showToast(`清理完成，删除了 ${data.deletedCount || 0} 个文件`);
            this.closeUnreferencedArea();
            this.loadAttachments();
            ui.refreshUserInfo();
        } catch (e) {
            ui.showToast("清理失败", false);
        }
    },

    // 检测无效附件
    async checkInvalidAttachmentsInManager() {
        ui.showToast("正在检测无效附件...");
        
        try {
            // 获取所有附件列表
            const res = await fetchWithTimeout('/api/attachments');
            if (!res.ok) throw new Error('获取附件列表失败');
            const files = await res.json();
            
            if (!files || files.length === 0) {
                ui.showToast("暂无附件");
                return;
            }
            

            
            // 批量检测附件是否有效
            const invalidAttachments = [];
            const checkPromises = files.map(async (file) => {
                const name = file.name || file.filename || file;
                const rawUrl = `/api/attachments/raw/${encodeURIComponent(name)}`;
                
                try {
                    const response = await fetch(rawUrl, {
                        method: 'HEAD',
                        cache: 'no-cache'
                    });
                    
                    if (!response.ok) {
                        invalidAttachments.push({
                            name: name,
                            url: rawUrl,
                            status: response.status
                        });

                    }
                } catch (error) {
                    invalidAttachments.push({
                        name: name,
                        url: rawUrl,
                        error: error.message
                    });
                    console.error('[Attachment] 检测附件失败:', name, error);
                }
            });
            
            await Promise.all(checkPromises);
            
            // 显示检测结果
            if (invalidAttachments.length === 0) {
                ui.showToast("所有附件均有效 ✅");

            } else {
                // 将无效附件信息存储到模块变量中
                this.invalidAttachmentsCache = invalidAttachments;
                
                // 重新渲染附件列表，标记无效附件
                this.loadAttachments();
                
                // 显示提示
                const message = `检测到 ${invalidAttachments.length} 个无效附件，已在列表中标记为红色`;
                ui.showToast(message);

            }
        } catch (e) {
            console.error('[Attachment] 检测失败:', e);
            ui.showToast("检测失败: " + e.message, false);
        }
    },
    
    // 清空无效附件缓存
    clearInvalidAttachmentsCache() {
        this.invalidAttachmentsCache = [];
    },

    // 批量删除无效附件
    async deleteInvalidAttachments() {
        if (!this.invalidAttachmentsCache || this.invalidAttachmentsCache.length === 0) {
            ui.showToast("没有检测到无效附件，请先点击'🔍检测无效'按钮");
            return;
        }

        if (!confirm(`确定删除 ${this.invalidAttachmentsCache.length} 个无效附件？\n\n${this.invalidAttachmentsCache.map(a => `• ${a.name}`).join('\n')}`)) {
            return;
        }

        ui.showToast("正在删除无效附件...");
        let deleteCount = 0;

        for (const invalid of this.invalidAttachmentsCache) {
            try {
                const deleteRes = await fetchWithTimeout(`/api/attachments/${encodeURIComponent(invalid.name)}`, {
                    method: 'DELETE'
                });
                if (deleteRes.ok) {
                    deleteCount++;

                }
            } catch (error) {
                console.error('[Attachment] 删除失败:', invalid.name, error);
            }
        }

        ui.showToast(`已清理 ${deleteCount} 个无效附件`);
        
        // 清空缓存并重新加载
        this.clearInvalidAttachmentsCache();
        this.loadAttachments();
        ui.refreshUserInfo();
    },

    // 自动修复笔记中的旧格式附件引用
    async fixAttachmentPaths() {
        if (!this.notesWithInvalidAttachments || this.notesWithInvalidAttachments.length === 0) {
            ui.showToast("没有检测到异常笔记，请先点击'🔍检测异常'按钮");
            return;
        }

        const message = `检测到 ${this.notesWithInvalidAttachments.length} 篇笔记有异常附件引用。\n\n是否尝试自动修复？\n\n修复规则：\n- 将 /api/uploads/username/filename 转换为 /api/attachments/raw/filename\n- 如果文件存在，将自动更新引用`;
        
        if (!confirm(message)) {
            return;
        }

        ui.showToast("正在修复附件引用...");
        let fixedCount = 0;
        let skippedCount = 0;

        try {
            // 获取所有可用附件
            const res = await fetchWithTimeout('/api/attachments', { cache: 'no-cache' });
            if (!res.ok) throw new Error('获取附件列表失败');
            const availableFiles = await res.json();
            
            // 创建可用附件的文件名集合（不包含路径）
            const availableFileNames = new Set(
                availableFiles.map(f => (f.name || f.filename || f))
            );

            // 获取所有笔记
            const notes = ui.notes || [];
            
            for (const note of notes) {
                if (!note.content || note.deleted) continue;

                // 查找该笔记是否在异常列表中
                const problematicNote = this.notesWithInvalidAttachments.find(
                    pn => pn.id.toString() === note.id.toString()
                );
                
                if (!problematicNote) continue;

                let content = note.content;
                let hasChanges = false;

                // 修复旧格式 /api/uploads/username/filename
                const oldUploadRegex = /!\[([^\]]*)\]\(\/api\/uploads\/[^\/]+\/([^)]+)\)/g;
                content = content.replace(oldUploadRegex, (match, alt, filename) => {
                    const decodedFilename = decodeURIComponent(filename);

                    
                    // 检查文件是否存在
                    if (availableFileNames.has(decodedFilename)) {
                        hasChanges = true;
                        const newUrl = `/api/attachments/raw/${encodeURIComponent(decodedFilename)}`;

                        return `![${alt}](${newUrl})`;
                    }
                    

                    return match;
                });

                // 如果有修复，更新笔记
                if (hasChanges) {
                    note.content = content;
                    note.updatedAt = Date.now();
                    note.isUnsynced = true;
                    fixedCount++;

                } else {
                    skippedCount++;

                }
            }

            // 保存更新后的笔记
            if (fixedCount > 0) {
                // 保存到云端
                for (const note of notes) {
                    if (note.isUnsynced) {
                        await ui.saveToCloud(note);
                    }
                }

                ui.render();

                ui.showToast(`已修复 ${fixedCount} 篇笔记的附件引用`);

                // 清空缓存并重新检测
                this.notesWithInvalidAttachments = [];

                // 延迟重新检测，显示修复效果
                setTimeout(() => {
                    this.checkNotesWithInvalidAttachments();
                }, 1000);
            } else {
                ui.showToast(`无法自动修复 ${skippedCount} 篇笔记，请手动处理`);
            }

        } catch (e) {
            console.error('[FixPath] 修复失败:', e);
            ui.showToast("修复失败: " + e.message, false);
        }
    },

    // 显示上传进度
    showUploadProgress(show, text = '正在上传...', percent = 0, details = '') {
        const container = document.getElementById('upload-progress-container');
        const progressBar = document.getElementById('upload-progress-bar');
        const progressText = document.getElementById('upload-progress-text');
        const progressPercent = document.getElementById('upload-progress-percent');
        const progressDetails = document.getElementById('upload-progress-details');

        if (!container) return;

        if (show) {
            container.style.display = 'block';
            progressText.textContent = text;
            progressPercent.textContent = `${percent}%`;
            progressBar.style.width = `${percent}%`;
            progressDetails.textContent = details;
        } else {
            container.style.display = 'none';
        }
    },

    // 分片上传文件
    async uploadFileInChunks(file, onProgress) {
        const totalSize = file.size;
        const chunkSize = 5 * 1024 * 1024; // 5MB 每个分片

        // 如果文件小于5MB，使用传统上传
        if (totalSize <= chunkSize) {
            return await this.uploadFileTraditional(file, onProgress);
        }

        try {
            // 1. 创建上传会话
            onProgress && onProgress(5, '创建上传会话...', `准备上传 ${this.formatFileSize(totalSize)}`);
            const sessionRes = await fetchWithTimeout('/api/upload/create-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: file.name,
                    totalSize: totalSize
                })
            }, 30000);

            if (!sessionRes.ok) {
                const errorData = await sessionRes.json();
                throw new Error(errorData.error || '创建上传会话失败');
            }

            const session = await sessionRes.json();
            const { uploadId, chunkSize: serverChunkSize, totalChunks } = session;

            // 2. 分片上传
            const chunks = Math.ceil(totalSize / serverChunkSize);
            let uploadedChunks = 0;
            let uploadedBytes = 0;
            let startTime = Date.now();

            for (let i = 0; i < chunks; i++) {
                const start = i * serverChunkSize;
                const end = Math.min(start + serverChunkSize, totalSize);
                const chunk = file.slice(start, end);

                // 将 Blob 转换为 ArrayBuffer，然后转为 Buffer
                const arrayBuffer = await chunk.arrayBuffer();
                const buffer = new Uint8Array(arrayBuffer);

                // 上传分片（设置60秒超时）
                const chunkRes = await fetchWithTimeout(`/api/upload/chunk`, {
                    method: 'POST',
                    headers: {
                        'uploadId': uploadId,
                        'chunkIndex': i.toString(),
                        'Content-Type': 'application/octet-stream'
                    },
                    body: buffer
                }, 60000);

                if (!chunkRes.ok) {
                    const errorData = await chunkRes.json();
                    console.error(`[Frontend] 上传分片失败:`, errorData);
                    throw new Error(`上传分片 ${i + 1}/${chunks} 失败: ${errorData.error}`);
                }

                uploadedChunks++;
                uploadedBytes += (end - start);

                // 计算上传速度
                const elapsedTime = (Date.now() - startTime) / 1000; // 秒
                const speedBytesPerSec = elapsedTime > 0 ? uploadedBytes / elapsedTime : 0;
                const speedText = this.formatFileSize(speedBytesPerSec) + '/s';

                const progress = Math.round((uploadedChunks / chunks) * 90) + 5; // 5% 到 95%
                onProgress && onProgress(
                    progress,
                    `上传中... (${uploadedChunks}/${chunks})`,
                    `已上传: ${this.formatFileSize(uploadedBytes)} / ${this.formatFileSize(totalSize)} | 速度: ${speedText}`
                );
            }

            // 3. 合并分片
            onProgress && onProgress(95, '合并文件...', '正在合并所有分片');
            const mergeRes = await fetchWithTimeout('/api/upload/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId })
            }, 60000);

            if (!mergeRes.ok) {
                const errorData = await mergeRes.json();
                throw new Error(errorData.error || '合并文件失败');
            }

            onProgress && onProgress(100, '上传完成', '文件已成功上传');
            return await mergeRes.json();

        } catch (error) {
            throw error;
        }
    },

    // 传统方式上传文件（小文件）
    async uploadFileTraditional(file, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            formData.append('file', file);

            let startTime = Date.now();

            // 上传进度
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    const uploaded = this.formatFileSize(event.loaded);
                    const total = this.formatFileSize(event.total);

                    // 计算上传速度
                    const elapsedTime = (Date.now() - startTime) / 1000; // 秒
                    const speedBytesPerSec = elapsedTime > 0 ? event.loaded / elapsedTime : 0;
                    const speedText = this.formatFileSize(speedBytesPerSec) + '/s';

                    onProgress && onProgress(percent, '上传中...', `已上传: ${uploaded} / ${total} | 速度: ${speedText}`);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        resolve(data);
                    } catch (e) {
                        reject(new Error('解析响应失败'));
                    }
                } else {
                    try {
                        const errorData = JSON.parse(xhr.responseText);
                        reject(new Error(errorData.error || '上传失败'));
                    } catch (e) {
                        reject(new Error(`上传失败: ${xhr.status}`));
                    }
                }
            };

            xhr.onerror = () => {
                reject(new Error('网络错误，上传失败'));
            };

            xhr.ontimeout = () => {
                reject(new Error('上传超时'));
            };

            xhr.timeout = 60000; // 60秒超时
            xhr.open('POST', '/api/upload', true);
            xhr.send(formData);
        });
    },

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 直接上传附件并插入到编辑器
    async handleDirectUpload(input) {
        if (!input.files[0]) return;
        const file = input.files[0];

        // 显示进度条
        this.showUploadProgress(true, `准备上传: ${file.name}`, 0, this.formatFileSize(file.size));

        try {
            // 使用分片上传
            const data = await this.uploadFileInChunks(file, (percent, text, details) => {
                this.showUploadProgress(true, text, percent, details);
            });

            this.showUploadProgress(true, '上传成功', 100, '文件已成功上传');

            // 关闭附件管理模态框
            const modal = document.getElementById('attachment-modal');
            if (modal) modal.classList.remove('show');

            // 插入到编辑器
            if (!ui.editor) {
                ui.showToast("编辑器未就绪", false);
                this.showUploadProgress(false);
                return;
            }

            const isImage = file.type.startsWith('image/');
            const fileName = data.url.split('/').pop();
            const tag = isImage ? `![${fileName}](${data.url})` : `[${fileName}](${data.url})`;

            // 获取正确的插入位置（适配 CodeMirror）
            let insertIndex = 0;

            if (ui.editor.getCursorPos) {
                // CodeMirror 适配器 - 直接使用 getCursorPos 获取光标索引
                insertIndex = ui.editor.getCursorPos();
            } else if (ui.editor.selectionStart !== undefined) {
                // 普通 textarea
                insertIndex = ui.editor.selectionStart;
            } else {
                // 文件末尾
                insertIndex = (ui.editor.getValue() || '').length;
            }

            // 插入内容
            const fullText = ui.editor.getValue();
            const newContent = fullText.substring(0, insertIndex) + tag + fullText.substring(insertIndex);
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

            // 刷新附件列表和用户信息
            this.loadAttachments();
            ui.refreshUserInfo();
            input.value = '';

            // 延迟隐藏进度条
            setTimeout(() => {
                this.showUploadProgress(false);
            }, 1000);

        } catch (e) {
            console.error('上传失败:', e);
            alert(`上传失败: ${e.message}`);
            this.showUploadProgress(true, '上传失败', 0, e.message);
            setTimeout(() => {
                this.showUploadProgress(false);
            }, 3000);
        }
    },

    // 加载分享列表
    async loadShares() {
        const modal = document.getElementById('share-modal');
        const listBody = document.getElementById('share-list-body');
        if (!modal || !listBody) {
            console.error('share modal not found');
            return;
        }
        modal.classList.add('show');
        
        // 清空现有内容
        listBody.innerHTML = '';
        
        // 创建搜索框区域
        let searchArea = document.getElementById('share-search-area');
        if (!searchArea) {
            searchArea = document.createElement('div');
            searchArea.id = 'share-search-area';
            searchArea.innerHTML = `
                <div style="padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <button onclick="api.loadShares()" style="background: var(--accent); color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; white-space: nowrap;">刷新列表</button>
                    <input type="text" id="share-search-input" placeholder="搜索分享..." 
                        style="flex: 1; min-width: 120px; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px;"
                        oninput="api.filterShares(this.value)" onkeydown="if(event.key==='Enter') api.filterShares(this.value)">
                    <button onclick="api.batchRevokeShares()" style="background: var(--red); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; white-space: nowrap;">批量删除</button>
                </div>
            `;
            listBody.appendChild(searchArea);
        }
        
        // 创建列表容器
        let listContainer = document.getElementById('share-list-container');
        if (!listContainer) {
            listContainer = document.createElement('div');
            listContainer.id = 'share-list-container';
            listBody.appendChild(listContainer);
        }
        
        // 显示加载中
        listContainer.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--gray);">加载中...</div>';

        try {
            const res = await fetchWithTimeout('/api/share/list');
            if (!res.ok) throw new Error('list fetch failed');
            const shares = await res.json();

            const notes = ui.notes || [];
            const notesMap = new Map(notes.map(n => [n.id.toString(), n]));

            if (!shares || shares.length === 0) {
                listContainer.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--gray);">暂无分享内容</div>';
                return;
            }

            // 存储所有分享数据
            api.allShares = shares;

            // 渲染分享列表
            api.renderShareList(shares, notesMap);
        } catch (e) {
            console.error('loadShares error', e);
            listContainer.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--red);">加载失败，请稍后重试</div>';
        }
    },

    // 渲染分享列表
    renderShareList(shares, notesMap, page = 1) {
        const listBody = document.getElementById('share-list-body');
        const listContainer = document.getElementById('share-list-container');
        if (!listBody || !listContainer) return;

        const pageSize = 20;
        const totalPages = Math.ceil(shares.length / pageSize);
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pageShares = shares.slice(startIndex, endIndex);

        // 表格头部
        const tableHeader = `
            <div class="share-list-compact" style="display: table; width: 100%; table-layout: fixed; border-collapse: collapse;">
                <div class="share-list-header" style="display: table-row; background: linear-gradient(to bottom, var(--bg), var(--border)); border-bottom: 2px solid var(--border);">
                    <span class="share-col-type" style="display: table-cell; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; width: 40px; text-align: center; font-size: 11px; font-weight: 600; color: var(--gray);">
                        <input type="checkbox" id="share-select-all" onchange="api.toggleSelectAllShares(this.checked)" style="cursor: pointer;">
                    </span>
                    <span class="share-col-name" style="display: table-cell; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; width: auto; font-size: 11px; font-weight: 600; color: var(--gray);">标题</span>
                    <span class="share-col-expires" style="display: table-cell; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; width: 75px; font-size: 11px; font-weight: 600; color: var(--gray);">有效期</span>
                    <span class="share-col-actions" style="display: table-cell; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; width: 100px; text-align: right; font-size: 11px; font-weight: 600; color: var(--gray);">操作</span>
                </div>
        `;

        // 表格内容
        const rows = pageShares.map(s => {
            let title = '';
            let typeLabel = '';
            if (s.targetType === 'note') {
                const note = notesMap.get(s.target);
                title = note ? (note.title || '无标题') : s.target;
                typeLabel = '📝';
            } else if (s.targetType === 'category') {
                title = s.target;
                typeLabel = '📁';
            } else {
                title = s.target.split('/').pop() || s.target;
                typeLabel = '📎';
            }

            const expiresText = s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : '永久';
            const escapedTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const shareUrl = `${location.protocol}//${location.host}/s/${s.token}`;

            return `
                <div class="share-item" style="display: table-row;">
                    <span class="share-col-type" style="display: table-cell; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; width: 40px; text-align: center; font-size: 14px;">
                        <input type="checkbox" class="share-select-checkbox" data-token="${s.token}" style="cursor: pointer;">
                    </span>
                    <span class="share-col-name" style="display: table-cell; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; width: auto; color: var(--text); overflow: hidden; text-overflow: ellipsis; max-width: 0; font-size: 13px;" title="${escapedTitle}">${typeLabel} ${title}</span>
                    <span class="share-col-expires" style="display: table-cell; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; width: 75px; font-size: 11px; color: var(--gray); font-weight: 500;">${expiresText}</span>
                    <span class="share-col-actions" style="display: table-cell; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; width: 100px; text-align: right;">
                        <button onclick="api.showShareLink('${s.token}', '${escapedTitle}')" title="复制" style="background: transparent; border: 1px solid var(--border); color: var(--text); padding: 3px 6px; border-radius: 4px; cursor: pointer; font-size: 12px; line-height: 1; min-width: 26px; height: 24px; display: inline-flex; align-items: center; justify-content: center; margin-right: 3px;">🔗</button>
                        <button onclick="window.open('${shareUrl}')" title="打开" style="background: transparent; border: 1px solid var(--border); color: var(--text); padding: 3px 6px; border-radius: 4px; cursor: pointer; font-size: 12px; line-height: 1; min-width: 26px; height: 24px; display: inline-flex; align-items: center; justify-content: center; margin-right: 3px;">👁</button>
                        <button onclick="api.revokeShare('${s.token}', '${escapedTitle}')" title="删除" class="btn-del" style="background: transparent; border: 1px solid var(--border); color: var(--text); padding: 3px 6px; border-radius: 4px; cursor: pointer; font-size: 12px; line-height: 1; min-width: 26px; height: 24px; display: inline-flex; align-items: center; justify-content: center; margin-right: 0;">🗑</button>
                    </span>
                </div>
            `;
        }).join('');

        // 分页控件
        let pagination = '';
        if (totalPages > 1) {
            const pageBtns = [];
            for (let i = 1; i <= totalPages; i++) {
                if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
                    pageBtns.push(`<button onclick="api.renderShareList(api.filteredShares || api.allShares, ui.notes ? new Map(ui.notes.map(n => [n.id.toString(), n])) : new Map(), ${i})" 
                        style="padding: 4px 10px; margin: 0 2px; background: ${i === page ? 'var(--accent)' : 'transparent'}; color: ${i === page ? 'white' : 'var(--text)'}; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">${i}</button>`);
                } else if (pageBtns.length > 0 && pageBtns[pageBtns.length - 1].includes('...') === false) {
                    pageBtns.push('<span style="padding: 4px;">...</span>');
                }
            }
            pagination = `
                <div style="padding: 12px 16px; border-top: 1px solid var(--border); display: flex; justify-content: center; align-items: center; gap: 8px;">
                    <span style="font-size: 12px; color: var(--gray);">共 ${shares.length} 条，第 ${page}/${totalPages} 页</span>
                    ${pageBtns.join('')}
                </div>
            `;
        }

        // 只更新列表容器的内容，不重新创建搜索框
        listContainer.innerHTML = tableHeader + rows + '</div>' + pagination;
    },

    // 过滤分享
    filterShares(keyword) {
        if (!api.allShares) return;
        
        keyword = keyword.toLowerCase().trim();

        if (!keyword) {
            api.filteredShares = api.allShares;
        } else {
            api.filteredShares = api.allShares.filter(s => {
                let title = '';
                if (s.targetType === 'note') {
                    const note = (ui.notes || []).find(n => n.id.toString() === s.target);
                    title = note ? (note.title || '') : s.target;
                } else if (s.targetType === 'category') {
                    title = s.target;
                } else {
                    title = s.target.split('/').pop() || s.target;
                }
                return title.toLowerCase().includes(keyword);
            });
        }

        const notesMap = new Map((ui.notes || []).map(n => [n.id.toString(), n]));
        api.renderShareList(api.filteredShares, notesMap, 1);
    },

    // 全选/取消全选
    toggleSelectAllShares(checked) {
        const checkboxes = document.querySelectorAll('.share-select-checkbox');
        checkboxes.forEach(cb => cb.checked = checked);
    },

    // 批量删除分享
    async batchRevokeShares() {
        const checkboxes = document.querySelectorAll('.share-select-checkbox:checked');
        if (checkboxes.length === 0) {
            ui.showToast('请先选择要删除的分享');
            return;
        }

        if (!confirm(`确定要删除选中的 ${checkboxes.length} 个分享吗？`)) return;

        let successCount = 0;
        for (const cb of checkboxes) {
            const token = cb.dataset.token;
            try {
                const res = await fetchWithTimeout('/api/share/revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                if (res.ok) successCount++;
            } catch (e) {
                console.error('删除分享失败:', token, e);
            }
        }

        if (successCount > 0) {
            ui.showToast(`成功删除 ${successCount} 个分享`);
            api.loadShares();
        } else {
            ui.showToast('删除失败，请重试');
        }
    },

    // 显示分享链接弹窗
    showShareLink(token, title) {
        const shareUrl = `${location.protocol}//${location.host}/s/${token}`;
        
        // 直接复制到剪贴板
        navigator.clipboard.writeText(shareUrl).then(() => {
            ui.showToast('链接已复制到剪贴板');
        }).catch(err => {
            console.error('复制失败:', err);
            ui.showToast('复制失败，请手动复制');
        });
    },

    // 撤销分享
    async revokeShare(token, title) {
        if (!confirm(`确定撤销分享 "${title}" 吗？`)) return;
        try {
            const res = await fetchWithTimeout('/api/share/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            if (res.ok) {
                ui.showToast("分享已撤销");
                this.loadShares();
            } else {
                const j = await res.json();
                ui.showToast("撤销失败：" + (j.error || "未知错误"), false);
            }
        } catch (e) {
            ui.showToast("操作失败", false);
        }
    },

    // 为附件生成公开分享链接
    async shareAttachment(encodedTarget) {
        try {
            const target = decodeURIComponent(encodedTarget);
            const expiresDays = prompt("分享有效期（天），留空表示永久：", "");
            const expiresMs = expiresDays ? parseInt(expiresDays) * 24 * 3600 * 1000 : 0;
            const body = { type: 'file', target: target, expiresMs: expiresMs || 0, public: true };
            const res = await fetchWithTimeout('/api/share/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || '创建失败');
            const url = j.url;
            await navigator.clipboard.writeText(url).catch(() => {});
            ui.showToast("已生成分享链接并复制到剪贴板");
        } catch (e) {
            console.error(e);
            ui.showToast("分享失败", false);
        }
    },

    // 复制分享链接（支持降级方案）
    async copyShareLink(token) {
        const url = `${location.protocol}//${location.host}/s/${token}`;
        
        // 方法1: 使用 Clipboard API
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(url);
                ui.showToast("链接已复制到剪贴板");
                return;
            } catch (e) {
                console.log('Clipboard API failed, trying fallback');
            }
        }
        
        // 方法2: 降级方案 - 创建临时文本框
        try {
            const textArea = document.createElement("textarea");
            textArea.value = url;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                ui.showToast("链接已复制到剪贴板");
            } else {
                throw new Error('execCommand failed');
            }
        } catch (e) {
            // 方法3: 直接显示链接让用户手动复制
            ui.showToast(`复制失败，请手动复制：${url}`, false, 5000);
            console.log('Share URL:', url);
        }
    },

    // 分享分类/目录
    async shareCategory(categoryName) {
        const expiresDays = prompt(`分享分类 "${categoryName}"\n\n有效期（天），留空表示永久：`, "");
        if (expiresDays === null) return; // 用户取消
        
        const expiresMs = expiresDays ? parseInt(expiresDays) * 24 * 3600 * 1000 : 0;
        
        try {
            const res = await fetchWithTimeout('/api/share/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'category',
                    target: categoryName,
                    expiresMs: expiresMs,
                    public: true
                })
            });
            
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '创建分享失败');
            }
            
            await navigator.clipboard.writeText(data.url).catch(() => {});
            ui.showToast(`已生成分类分享链接并复制到剪贴板\n包含该分类下的所有笔记，且会实时更新`);
        } catch (e) {
            console.error(e);
            ui.showToast(e.message || "分享失败", false);
        }
    },

    // 检测笔记中引用了但实际不存在的附件 - 使用缓存优化
    async checkNotesWithInvalidAttachments() {
        ui.showToast("正在检测笔记中的附件引用...");

        try {
            // 获取所有笔记
            const notes = ui.notes || [];
            if (!notes || notes.length === 0) {
                ui.showToast("暂无笔记");
                return;
            }

            // 获取所有可用的附件列表（使用已有缓存）
            let availableFiles = this.attachmentsCache;
            if (!availableFiles || availableFiles.length === 0) {
                const res = await fetchWithTimeout('/api/attachments');
                if (!res.ok) throw new Error('获取附件列表失败');
                availableFiles = await res.json() || [];
                this.attachmentsCache = availableFiles;
            }
            
            // 创建可用附件的文件名集合（用于快速查找）
            const availableFileNames = new Set(
                availableFiles.map(f => (f.name || f.filename || f))
            );

            // 检测引用异常的笔记
            const problematicNotes = [];
            
            // 使用单一正则表达式提高效率
            const attachmentRegex = /\/(?:api\/attachments\/raw|api\/uploads)\/([^"')\s]+)/g;
            
            for (const note of notes) {
                if (!note.content || note.deleted) continue;

                const matches = [];
                let match;
                attachmentRegex.lastIndex = 0;
                while ((match = attachmentRegex.exec(note.content)) !== null) {
                    const filename = decodeURIComponent(match[1]);
                    matches.push(filename);
                }

                if (matches.length === 0) continue;

                // 检查每个引用的附件是否存在
                const invalidAttachments = matches.filter(filename => {
                    return !availableFileNames.has(filename);
                });

                // 如果有无效引用，记录该笔记
                if (invalidAttachments.length > 0) {
                    const uniqueInvalid = [...new Set(invalidAttachments)];
                    problematicNotes.push({
                        id: note.id,
                        title: note.title || '无标题',
                        invalidAttachments: uniqueInvalid,
                        invalidCount: uniqueInvalid.length
                    });
                }
            }

            // 保存结果并显示
            this.notesWithInvalidAttachments = problematicNotes;
            this.showInvalidNotesArea(problematicNotes);
            
            // 重新渲染笔记列表，标记有问题的笔记
            ui.render(undefined, true);

        } catch (e) {
            ui.showToast("检测失败: " + e.message, false);
        }
    },
    
    // 显示引用无效附件的笔记列表
    showInvalidNotesArea(problematicNotes) {
        const area = document.getElementById('invalid-notes-area');
        const list = document.getElementById('invalid-notes-list');
        const title = document.getElementById('invalid-notes-title');
        
        if (!area || !list) {
            const msg = problematicNotes.length === 0 
                ? "所有笔记的附件引用均正常 ✅" 
                : `检测到 ${problematicNotes.length} 篇笔记引用了不存在的附件`;
            ui.showToast(msg, problematicNotes.length === 0);
            return;
        }
        
        if (problematicNotes.length === 0) {
            title.textContent = '引用无效附件的笔记 (0)';
            title.style.color = 'var(--green)';
            list.innerHTML = '<div style="text-align:center;padding:12px;color:var(--gray);font-size:12px;">所有笔记的附件引用均正常 ✅</div>';
        } else {
            title.textContent = `引用无效附件的笔记 (${problematicNotes.length})`;
            title.style.color = 'var(--red)';
            list.innerHTML = problematicNotes.map(note => {
                // 提取纯标题（不含分类）
                let displayTitle = note.title;
                if (displayTitle.includes('/')) {
                    displayTitle = displayTitle.split('/').slice(1).join('/').trim();
                }
                return `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.2);">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:12px;color:var(--text);cursor:pointer;" 
                                 onclick="api.switchToNote('${note.id}');api.closeInvalidNotesArea();document.getElementById('attachment-modal').classList.remove('show');" 
                                 title="点击打开笔记">
                                ${displayTitle}
                                <span style="color:var(--red);margin-left:4px;">(${note.invalidCount}个无效)</span>
                            </div>
                            <div style="font-size:10px;color:var(--gray);margin-top:2px;">
                                ${note.invalidAttachments.join(', ')}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
        
        area.style.display = 'block';
    },
    
    // 关闭无效笔记展示区域
    closeInvalidNotesArea() {
        const area = document.getElementById('invalid-notes-area');
        if (area) area.style.display = 'none';
    },
    
    // 切换到指定笔记
    switchToNote(noteId) {
        if (ui.switch) {
            ui.switch(noteId);
        }
    },

    // 分享指定笔记（通过ID）
    async shareNoteById(noteId) {
        const notes = ui.notes || [];
        const note = notes.find(n => n.id.toString() === noteId.toString());
        if (!note) return ui.showToast("笔记不存在", false);
        
        try {
            const expiresDays = prompt(`分享笔记 "${note.title || '无标题'}"\n\n有效期（天），留空表示永久：`, "");
            if (expiresDays === null) return;
            
            const expiresMs = expiresDays ? parseInt(expiresDays) * 24 * 3600 * 1000 : 0;
            
            const res = await fetchWithTimeout('/api/share/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'note',
                    target: noteId.toString(),
                    expiresMs: expiresMs,
                    public: true
                })
            });
            
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '创建分享失败');
            }
            
            // 尝试复制到剪贴板
            this.copyToClipboard(data.url, "已生成分享链接并复制到剪贴板");
        } catch (e) {
            console.error(e);
            ui.showToast(e.message || "分享失败", false);
        }
    },

    // 通用复制到剪贴板方法
    async copyToClipboard(text, successMessage = "已复制到剪贴板") {
        // 方法1: 使用 Clipboard API
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                ui.showToast(successMessage);
                return true;
            } catch (e) {
                console.log('Clipboard API failed, trying fallback');
            }
        }
        
        // 方法2: 降级方案 - 创建临时文本框
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                ui.showToast(successMessage);
                return true;
            }
        } catch (e) {}
        
        // 方法3: 显示链接让用户手动复制
        ui.showToast(`请手动复制：${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`, false, 5000);
        return false;
    },

    // 为当前编辑的笔记生成公开分享链接
    async shareCurrentNote() {
        if (!ui.activeId) return ui.showToast("请选择要分享的笔记", false);
        try {
            const expiresDays = prompt("分享有效期（天），留空表示永久：", "");
            const expiresMs = expiresDays ? parseInt(expiresDays) * 24 * 3600 * 1000 : 0;
            const body = { type: 'note', target: ui.activeId, expiresMs: expiresMs || 0, public: true };
            const res = await fetchWithTimeout('/api/share/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || '创建失败');
            const url = j.url;
            this.copyToClipboard(url, "已生成分享链接并复制到剪贴板");
        } catch (e) {
            console.error(e);
            ui.showToast(e.message || "分享失败", false);
        }
    }
};

// 导出
window.api = APIManager;
