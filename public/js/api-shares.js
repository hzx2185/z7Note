// 分享和公开链接相关 API
export function createShareApi(fetchWithTimeout) {
    return {
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
                <div class="share-search-bar">
                    <button onclick="api.loadShares()" class="share-action-btn refresh">刷新列表</button>
                    <input type="text" id="share-search-input" class="share-search-input" placeholder="搜索分享..."
                        oninput="api.filterShares(this.value)" onkeydown="if(event.key==='Enter') api.filterShares(this.value)">
                    <button onclick="api.batchRevokeShares()" class="share-action-btn delete">批量删除</button>
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
        listContainer.innerHTML = '<div class="share-list-state">加载中...</div>';

        try {
            const res = await fetchWithTimeout('/api/share/list');
            if (!res.ok) throw new Error('list fetch failed');
            const shares = await res.json();

            const notes = ui.notes || [];
            const notesMap = new Map(notes.map(n => [n.id.toString(), n]));

            if (!shares || shares.length === 0) {
                listContainer.innerHTML = '<div class="share-list-state">暂无分享内容</div>';
                return;
            }

            // 存储所有分享数据
            api.allShares = shares;

            // 渲染分享列表
            api.renderShareList(shares, notesMap);
        } catch (e) {
            console.error('loadShares error', e);
            listContainer.innerHTML = '<div class="share-list-state share-list-state-danger">加载失败，请稍后重试</div>';
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
            <div class="share-list-compact">
                <div class="share-list-header">
                    <span class="share-cell share-cell-header share-col-type">
                        <input type="checkbox" id="share-select-all" onchange="api.toggleSelectAllShares(this.checked)">
                    </span>
                    <span class="share-cell share-cell-header share-col-name">标题</span>
                    <span class="share-cell share-cell-header share-col-expires">有效期</span>
                    <span class="share-cell share-cell-header share-col-actions">操作</span>
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
                title = s.target.split('_').pop() || s.target;
                typeLabel = '📎';
            }

            const expiresText = s.expiresAt ? this.formatDate(s.expiresAt) : '永久';
            const escapedTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const shareUrl = `${location.protocol}//${location.host}/s/${s.token}`;

            return `
                <div class="share-item">
                    <span class="share-cell share-col-type">
                        <input type="checkbox" class="share-select-checkbox" data-token="${s.token}">
                    </span>
                    <span class="share-cell share-col-name" title="${escapedTitle}">${typeLabel} ${title}</span>
                    <span class="share-cell share-col-expires">${expiresText}</span>
                    <span class="share-cell share-col-actions">
                        <button onclick="api.showShareLink('${s.token}', '${escapedTitle}')" title="复制" class="share-action-icon">🔗</button>
                        <button onclick="window.open('${shareUrl}')" title="打开" class="share-action-icon">👁</button>
                        <button onclick="api.revokeShare('${s.token}', '${escapedTitle}')" title="删除" class="share-action-icon btn-del">🗑</button>
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
                        class="share-pagination-btn ${i === page ? 'active' : ''}">${i}</button>`);
                } else if (pageBtns.length > 0 && pageBtns[pageBtns.length - 1].includes('...') === false) {
                    pageBtns.push('<span class="share-pagination-ellipsis">...</span>');
                }
            }
            pagination = `
                <div class="share-pagination">
                    <span class="share-pagination-info">共 ${shares.length} 条，第 ${page}/${totalPages} 页</span>
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
                    title = s.target.split('_').pop() || s.target;
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
                console.error('删除分享失败:', e);
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
                // Clipboard API 失败，尝试降级方案
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
            list.innerHTML = '<div class="attachment-audit-state attachment-audit-state-success">所有笔记的附件引用均正常 ✅</div>';
        } else {
            title.textContent = `引用无效附件的笔记 (${problematicNotes.length})`;
            title.style.color = 'var(--red)';
            list.innerHTML = problematicNotes.map(note => {
                // 提取纯标题（不含分类）
                let displayTitle = note.title;
                if (displayTitle.includes('_')) {
                    displayTitle = displayTitle.split('_').slice(1).join('_').trim();
                }
                return `
                    <div class="attachment-audit-row attachment-audit-row-note">
                        <div class="attachment-audit-copy">
                            <div class="attachment-audit-link"
                                 onclick="api.switchToNote('${note.id}');api.closeInvalidNotesArea();document.getElementById('attachment-modal').classList.remove('show');"
                                 title="点击打开笔记">
                                ${displayTitle}
                                <span class="attachment-audit-link-danger badge-inline-offset">(${note.invalidCount}个无效)</span>
                            </div>
                            <div class="attachment-audit-detail">
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
                // Clipboard API failed, trying fallback
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
            ui.showToast(e.message || "分享失败", false);
        }
    }
    };
}
