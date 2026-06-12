export function enhanceUISave(UIManager, fetchWithTimeout) {
    Object.assign(UIManager, {
    // 保存笔记 - 使用防抖减少频繁写入
    _saveDebounceTimer: null,
    _isSaving: false, // 防止重复保存
    _scheduledSavePromise: null,
    _scheduledSaveResolve: null,
    _scheduledSaveReject: null,
    _lastSavedSignature: '',
    _saveCooldownUntil: 0,
    _saveFailureCount: 0,

    _consumeScheduledSaveSettlers() {
        const resolve = this._scheduledSaveResolve;
        const reject = this._scheduledSaveReject;
        this._scheduledSavePromise = null;
        this._scheduledSaveResolve = null;
        this._scheduledSaveReject = null;
        return { resolve, reject };
    },

    _resolveScheduledSave(result = true) {
        const { resolve } = this._consumeScheduledSaveSettlers();
        if (resolve) resolve(result);
    },

    _rejectScheduledSave(error) {
        const { reject } = this._consumeScheduledSaveSettlers();
        if (reject) reject(error);
    },

    _getSaveDebounceDelay() {
        const host = window.location.hostname;
        if (host === '127.0.0.1' || host === 'localhost') {
            return 3000;
        }
        return 10000;
    },

    _getSaveCooldownMs() {
        const host = window.location.hostname;
        if (host === '127.0.0.1' || host === 'localhost') {
            return 4000;
        }
        return 8000;
    },

    _buildNoteSignature(note, contentOverride) {
        if (!note) return '';
        const content = this._normalizeNoteContent(contentOverride !== undefined ? contentOverride : (note.content || ''));
        return `${note.id}|${note.title || ''}|${content}`;
    },

    _normalizeNoteContent(content) {
        return (content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    },

    normalizeTimestamp(ts) {
        if (ts === null || ts === undefined || ts === '') return null;
        if (typeof ts === 'string') {
            const parsed = Date.parse(ts);
            if (!Number.isFinite(parsed) || parsed <= 0) return null;
            return parsed;
        }
        const num = Number(ts);
        if (!Number.isFinite(num) || num <= 0) return null;
        return num > 10000000000 ? num : num * 1000;
    },

    formatTimestamp(ts) {
        const normalized = this.normalizeTimestamp(ts);
        return normalized ? new Date(normalized).toLocaleString('zh-CN') : '-';
    },

    formatCompactTimestamp(ts) {
        const normalized = this.normalizeTimestamp(ts);
        if (!normalized) return '-';
        const date = new Date(normalized);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${month}-${day} ${hours}:${minutes}`;
    },

    buildNoteMetaText(note) {
        if (!note) return '';
        const createdCompact = this.formatCompactTimestamp(note.createdAt);
        const updatedCompact = this.formatCompactTimestamp(note.updatedAt);
        return `创 ${createdCompact} · 改 ${updatedCompact}`;
    },

    updateNoteMeta(note) {
        const metaEl = document.getElementById('note-meta');
        if (!metaEl) return;
        if (!note) {
            metaEl.textContent = '';
            metaEl.title = '';
            return;
        }
        const createdFull = this.formatTimestamp(note.createdAt);
        const updatedFull = this.formatTimestamp(note.updatedAt);
        metaEl.title = `创建：${createdFull} · 修改：${updatedFull}`;
        metaEl.textContent = this.buildNoteMetaText(note);
    },

    refreshNoteMetaForViewport() {
        if (!this.activeId) return;
        const note = this.notes.find(x => x.id?.toString() === this.activeId.toString());
        if (note) {
            this.updateNoteMeta(note);
        }
    },

    _captureActiveNoteSnapshot() {
        if (!this.activeId) return null;
        const idx = this.notes.findIndex(x => x.id.toString() === this.activeId.toString());
        if (idx === -1) return null;

        const note = this.notes[idx];
        const content = this.editor && this.editor.getValue ? this.editor.getValue() : (note.content || '');
        return {
            ...note,
            content
        };
    },

    _hasPendingSave() {
        const snapshot = this._captureActiveNoteSnapshot();
        if (!snapshot) return false;
        return this._buildNoteSignature(snapshot, snapshot.content) !== this._lastSavedSignature;
    },

    async flushPendingSave(options = {}) {
        clearTimeout(this._saveDebounceTimer);
        const snapshot = options.noteSnapshot || this._captureActiveNoteSnapshot();
        if (!snapshot) {
            this._resolveScheduledSave(true);
            return true;
        }
        if (this._buildNoteSignature(snapshot, snapshot.content) === this._lastSavedSignature) {
            this._resolveScheduledSave(true);
            return true;
        }
        try {
            const result = await this._saveSnapshot(snapshot, options);
            this._resolveScheduledSave(result);
            return result;
        } catch (error) {
            this._rejectScheduledSave(error);
            throw error;
        }
    },

    async save() {
        // 输入法期间完全禁止保存
        if (this._isComposing) {
            return false;
        }
        if (!this.activeId || !this.editor) {
            return false;
        }
        if (!this._hasPendingSave()) {
            return true;
        }

        clearTimeout(this._saveDebounceTimer);
        if (!this._scheduledSavePromise) {
            this._scheduledSavePromise = new Promise((resolve, reject) => {
                this._scheduledSaveResolve = resolve;
                this._scheduledSaveReject = reject;
            });
        }
        const debounceDelay = this._getSaveDebounceDelay();
        const cooldownDelay = Math.max(0, this._saveCooldownUntil - Date.now());
        const finalDelay = Math.max(debounceDelay, cooldownDelay);

        this._saveDebounceTimer = setTimeout(async () => {
            try {
                const result = await this._doSave();
                this._resolveScheduledSave(result);
            } catch (error) {
                this._rejectScheduledSave(error);
            }
        }, finalDelay);

        return this._scheduledSavePromise;
    },

    // 实际保存逻辑 - 云端优先
    async _doSave(options = {}) {
        if (!this.activeId || !this.editor) return false;

        // 二次检查输入法状态，确保不会在输入时保存
        if (this._isComposing) {
            return false;
        }

        const snapshot = this._captureActiveNoteSnapshot();
        if (!snapshot) return false;
        if (this._buildNoteSignature(snapshot, snapshot.content) === this._lastSavedSignature) return true;
        return await this._saveSnapshot(snapshot, options);
    },

    async _saveSnapshot(snapshot, options = {}) {
        if (!snapshot || snapshot.id === undefined || snapshot.id === null) return false;

        const idx = this.notes.findIndex(x => x.id.toString() === snapshot.id.toString());
        if (idx === -1) return false;

        const content = snapshot.content || '';
        const currentNote = this.notes[idx];
        const isCurrentActiveNote = this.activeId && this.activeId.toString() === snapshot.id.toString();

        // 检查是否是临时笔记且内容为空
        if (currentNote.isTemp && (!content || content.trim().length === 0)) {
            // 删除临时笔记
            this.notes = this.notes.filter(n => n.id.toString() !== snapshot.id.toString());

            // 切换到第一个有内容的笔记
            const notesWithContent = this.notes.filter(n => {
                if (n.deleted) return false;
                const hasContent = n.content && n.content.trim().length > 0;
                const hasRealTitle = n.title && n.title !== '新笔记';
                return hasContent || hasRealTitle;
            });

            if (notesWithContent.length > 0) {
                const latest = notesWithContent.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
                if (isCurrentActiveNote) {
                    this.switch(latest.id);
                }
            } else {
                if (isCurrentActiveNote) {
                    this.activeId = null;
                    if (this.editor) this.editor.destroy();
                    this.updatePreview("");
                }
            }

            this.render();
            return true;
        }

        // 如果是临时笔记且有内容，转为正式笔记
        if (currentNote.isTemp && content && content.trim().length > 0) {
            currentNote.isTemp = false;
        }

        // 保存笔记，标题不变（用户需要手工修改标题）
        const now = Math.floor(Date.now() / 1000);
        const createdAt = this.notes[idx].createdAt || currentNote.createdAt || now;
        this.notes[idx] = {
            ...this.notes[idx],
            content,
            createdAt,
            updatedAt: now,
            isTemp: false
        };
        if (this.notes[idx].id === this.activeId) {
            this.updateNoteMeta(this.notes[idx]);
        }

        // 直接调用API保存到云端
        return await this.saveToCloud(this.notes[idx], 1, options);
    },

    _isSaving: false,
    _pendingSave: null,

    // 保存到云端
    async saveToCloud(note, attempt = 1, options = {}) {
        // 如果正在保存，将当前笔记存入等待队列，确保最后一次修改不丢失
        if (this._isSaving) {
            this._pendingSave = note;
            return 'queued';
        }

        try {
            // 输入法期间完全禁止云端同步
            if (this._isComposing) {
                return false;
            }

            this._isSaving = true;
            // 修正：后端 /api/files 期望接收数组格式
            const res = await fetchWithTimeout('/api/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                keepalive: Boolean(options.keepalive),
                body: JSON.stringify([{
                    id: note.id,
                    title: note.title,
                    content: note.content,
                    createdAt: note.createdAt,
                    updatedAt: note.updatedAt
                }])
            }, 20000);

            const contentType = res.headers.get('content-type');
            let result;
            if (contentType && contentType.includes('application/json')) {
                result = await res.json();
            }

            if (res.ok && result) {
                // 更新本地笔记数据
                const noteToUpdate = Array.isArray(result.notes) ? result.notes[0] : result.note;
                const idx = this.notes.findIndex(n => n.id.toString() === note.id.toString());
                if (idx !== -1 && noteToUpdate) {
                    if (noteToUpdate.updatedAt === note.updatedAt) {
                        this.notes[idx] = noteToUpdate;
                    } else {
                        this.notes[idx] = {
                            ...this.notes[idx],
                            id: noteToUpdate.id,
                            updatedAt: noteToUpdate.updatedAt
                        };
                    }
                }
                const latestNote = this.notes[idx] || noteToUpdate || note;
                if (latestNote && latestNote.id === this.activeId) {
                    this.updateNoteMeta(latestNote);
                }
                this._lastSavedSignature = this._buildNoteSignature(latestNote);
                this._saveFailureCount = 0;
                this._saveCooldownUntil = 0;
                this.render(undefined, true);
                return true;
            } else {
                if (res.status === 502 && attempt < 2) {
                    console.warn('[Save] 网关异常，准备重试一次');
                    await new Promise(resolve => setTimeout(resolve, 2500));
                    this._isSaving = false;
                    return await this.saveToCloud(note, attempt + 1, options);
                }
                this._saveFailureCount += 1;
                this._saveCooldownUntil = Date.now() + this._getSaveCooldownMs();
                console.error('[Save] 服务器返回错误:', res.status);
                this.showToast(res.status === 502 ? '保存通道不稳定，请稍后重试' : '保存失败，请检查网络连接', false);
                return false;
            }
        } catch (e) {
            if ((e.message === '请求超时' || e.name === 'AbortError') && attempt < 2) {
                console.warn('[Save] 保存超时，准备重试一次');
                await new Promise(resolve => setTimeout(resolve, 2500));
                this._isSaving = false;
                return await this.saveToCloud(note, attempt + 1, options);
            }
            this._saveFailureCount += 1;
            this._saveCooldownUntil = Date.now() + this._getSaveCooldownMs();
            console.error('[Save] 请求异常:', e);
            this.showToast('无法连接服务器，请稍后重试', false);
                return false;
        } finally {
            this._isSaving = false;
            // 如果在保存期间有新的修改，立即执行最后一次待办保存
            if (this._pendingSave) {
                const nextNote = this._pendingSave;
                this._pendingSave = null;
                void this.saveToCloud(nextNote);
            }
        }
    },
    });

    if (!UIManager._noteMetaResizeBound) {
        UIManager._noteMetaResizeBound = true;
        UIManager._noteMetaResizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(UIManager._noteMetaResizeTimer);
            UIManager._noteMetaResizeTimer = setTimeout(() => {
                if (typeof UIManager.refreshNoteMetaForViewport === 'function') {
                    UIManager.refreshNoteMetaForViewport();
                }
            }, 80);
        });
    }
}
