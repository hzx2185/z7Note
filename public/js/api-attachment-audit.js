// 附件审计和清理 API
export function createAttachmentAuditApi(fetchWithTimeout) {
    return {
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
            list.innerHTML = '<div class="attachment-audit-state attachment-audit-state-success">所有附件都已被引用 ✅</div>';
        } else {
            title.textContent = `未引用附件列表 (${unreferenced.length})`;
            title.style.color = 'var(--orange)';
            list.innerHTML = unreferenced.map(att => `
                <div class="attachment-audit-row">
                    <span class="attachment-audit-name" title="${att.name}">${att.name}</span>
                    <span class="file-meta-sm file-meta-shrink">${att.size}</span>
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
                    // 附件检测失败，静默处理
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
                    note.updatedAt = Math.floor(Date.now() / 1000);
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
    }
    };
}
