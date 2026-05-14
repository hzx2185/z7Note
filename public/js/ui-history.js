export function enhanceUIHistory(UIManager, fetchWithTimeout) {
  Object.assign(UIManager, {
    _historyVersions: [],
    _selectedHistoryVersionId: null,

    _escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    _formatVersionTime(ts) {
      const normalized = this.normalizeTimestamp ? this.normalizeTimestamp(ts) : Number(ts) * 1000;
      return normalized ? new Date(normalized).toLocaleString('zh-CN') : '-';
    },

    _getVersionSourceLabel(source) {
      const labels = {
        edit: '编辑前',
        sync: '同步前',
        'sync-delete': '同步删除前',
        delete: '删除前',
        'batch-delete': '批量删除前',
        'batch-replace': '批量替换前',
        'batch-move': '批量移动前',
        'restore-before': '恢复前',
        auto: '自动'
      };
      return labels[source] || source || '自动';
    },

    async showHistory() {
      if (!this.activeId) {
        this.showToast('请先打开笔记', false);
        return;
      }

      const modal = document.getElementById('history-modal');
      const list = document.getElementById('history-list');
      const preview = document.getElementById('history-preview');
      const restoreBtn = document.getElementById('history-restore-btn');
      if (!modal || !list || !preview || !restoreBtn) return;

      modal.classList.add('show');
      list.innerHTML = '<div class="empty-state-inline">加载中...</div>';
      preview.textContent = '选择一个历史版本查看内容';
      restoreBtn.disabled = true;
      this._selectedHistoryVersionId = null;

      try {
        await this.flushPendingSave({ noteSnapshot: this._captureActiveNoteSnapshot() });
        const res = await fetchWithTimeout(`/api/notes/${encodeURIComponent(this.activeId)}/versions`, {
          cache: 'no-store'
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        this._historyVersions = await res.json();
        this._renderHistoryList();
      } catch (error) {
        console.error('[History] 加载失败:', error);
        list.innerHTML = '<div class="empty-state-inline">无法加载历史版本</div>';
      }
    },

    closeHistory() {
      const modal = document.getElementById('history-modal');
      if (modal) modal.classList.remove('show');
      this._historyVersions = [];
      this._selectedHistoryVersionId = null;
    },

    _renderHistoryList() {
      const list = document.getElementById('history-list');
      if (!list) return;

      if (!this._historyVersions || this._historyVersions.length === 0) {
        list.innerHTML = '<div class="empty-state-inline">暂无历史版本</div>';
        return;
      }

      list.innerHTML = this._historyVersions.map(version => `
        <button class="history-version-item" data-version-id="${this._escapeHtml(version.id)}" type="button">
          <span class="history-version-title">${this._escapeHtml(version.title || '无标题')}</span>
          <span class="history-version-meta">
            ${this._escapeHtml(this._formatVersionTime(version.createdAt))}
            · ${this._escapeHtml(this._getVersionSourceLabel(version.source))}
            · ${Number(version.contentLength || 0).toLocaleString('zh-CN')} 字符
          </span>
        </button>
      `).join('');

      list.querySelectorAll('.history-version-item').forEach(item => {
        item.addEventListener('click', () => this.selectHistoryVersion(item.dataset.versionId));
      });
    },

    async selectHistoryVersion(versionId) {
      if (!this.activeId || !versionId) return;
      const preview = document.getElementById('history-preview');
      const restoreBtn = document.getElementById('history-restore-btn');
      if (!preview || !restoreBtn) return;

      preview.textContent = '加载中...';
      restoreBtn.disabled = true;

      try {
        const res = await fetchWithTimeout(
          `/api/notes/${encodeURIComponent(this.activeId)}/versions/${encodeURIComponent(versionId)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const version = await res.json();
        this._selectedHistoryVersionId = version.id;
        preview.textContent = version.content || '';
        restoreBtn.disabled = false;

        document.querySelectorAll('.history-version-item').forEach(item => {
          item.classList.toggle('active', item.dataset.versionId === version.id);
        });
      } catch (error) {
        console.error('[History] 加载详情失败:', error);
        preview.textContent = '无法加载这个历史版本';
      }
    },

    async restoreSelectedHistory() {
      if (!this.activeId || !this._selectedHistoryVersionId) return;
      if (!confirm('确定恢复到这个历史版本吗？当前内容会先保存为一个可回退版本。')) return;

      try {
        await this.flushPendingSave({ noteSnapshot: this._captureActiveNoteSnapshot() });
        const res = await fetchWithTimeout(
          `/api/notes/${encodeURIComponent(this.activeId)}/versions/${encodeURIComponent(this._selectedHistoryVersionId)}/restore`,
          { method: 'POST' },
          20000
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);

        const note = result.note;
        this.upsertNote(note, { toTop: true });
        const titleInput = document.getElementById('note-title-input');
        if (titleInput) titleInput.value = note.title || '';
        if (this.editor?.setValue) this.editor.setValue(note.content || '');
        this._lastSavedSignature = this._buildNoteSignature(note, note.content || '');
        this.updateNoteMeta(note);
        this.updatePreview(true);
        this.render(undefined, true);
        this.closeHistory();
        this.showToast('已恢复历史版本');
      } catch (error) {
        console.error('[History] 恢复失败:', error);
        this.showToast(error.message || '恢复失败', false);
      }
    }
  });
}
