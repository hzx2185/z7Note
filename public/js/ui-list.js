const NOTE_SHARE_ICON = '<svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-share"></use></svg>';
const NOTE_DELETE_ICON = '<svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-trash"></use></svg>';

export function enhanceUIList(UIManager) {
  Object.assign(UIManager, {
    _getNoteFolder(note) {
      if (note.title && note.title.includes('_')) {
        const firstPart = note.title.split('_')[0];
        return firstPart.replace(/^#*\s*/, '').trim() || '未分类';
      }
      return '未分类';
    },

    _getFilteredNotes(query) {
      const normalizedQuery = (query || '').toLowerCase();
      const filtered = [];

      for (const note of this.notes) {
        if (note.deleted) continue;
        if (
          !normalizedQuery ||
          note.title.toLowerCase().includes(normalizedQuery) ||
          (note.content && note.content.toLowerCase().includes(normalizedQuery))
        ) {
          filtered.push(note);
        }
      }

      filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return filtered;
    },

    render(limit, force = false, isLoadMore = false) {
      const q = document.getElementById('search').value.toLowerCase();
      const list = document.getElementById('list');
      if (!list) return;

      if (limit === undefined) {
        limit = 9999;
      }
      this.currentLimit = limit;

      const currentScroll = list.scrollTop;
      const currentHash = this._calculateNotesHash(this.notes);
      if (!force && !isLoadMore && currentHash === this._lastRenderedNotesHash) return;
      this._lastRenderedNotesHash = currentHash;

      const filtered = this._getFilteredNotes(q);
      const displayNotes = q ? filtered : filtered.slice(0, limit);

      if (!this.showCategories) {
        this._renderFlatNotes(list, displayNotes, filtered, limit, q, currentScroll, isLoadMore);
        return;
      }

      const groups = {};
      const folderMaxTime = {};

      for (const note of displayNotes) {
        const folder = this._getNoteFolder(note);
        if (!groups[folder]) {
          groups[folder] = [];
          folderMaxTime[folder] = 0;
        }
        groups[folder].push(note);

        const time = note.updatedAt || 0;
        if (time > folderMaxTime[folder]) {
          folderMaxTime[folder] = time;
        }
      }

      this._prepareListForRender(list, isLoadMore);

      const fragment = document.createDocumentFragment();
      const sortedFolders = Object.keys(groups).sort((a, b) => folderMaxTime[b] - folderMaxTime[a]);

      for (const folder of sortedFolders) {
        const isCollapsed = this.collapsedFolders.has(folder);

        let content = list.querySelector(`.folder-content[data-folder="${folder}"]`);
        if (!content) {
          const header = document.createElement('div');
          header.className = `folder-item ${isCollapsed ? 'collapsed' : ''}`;
          header.style.cssText = 'display: flex !important; justify-content: space-between; align-items: center;';
          header.onclick = () => this.toggleFolder(folder);

          const name = document.createElement('span');
          name.textContent = folder;
          name.style.flex = '1';
          name.style.cursor = 'pointer';
          header.appendChild(name);

          if (folder !== '未分类') {
            const shareBtn = document.createElement('button');
            shareBtn.className = 'tool-btn';
            shareBtn.textContent = '分享';
            shareBtn.style.cssText = 'font-size:10px;padding:2px 6px;margin-left:4px;';
            shareBtn.onclick = (e) => {
              e.stopPropagation();
              api.shareCategory(folder);
            };
            header.appendChild(shareBtn);
          }

          fragment.appendChild(header);

          content = document.createElement('div');
          content.className = `folder-content ${isCollapsed ? 'hidden' : ''}`;
          content.dataset.folder = folder;
          fragment.appendChild(content);
        }

        for (const note of groups[folder]) {
          if (list.querySelector(`.note-item[data-id="${note.id}"]`)) continue;

          content.appendChild(this._createNoteElement(note));
        }
      }

      list.appendChild(fragment);
      this._finishListRender(list, filtered, limit, q, currentScroll, isLoadMore);
    },

    _prepareListForRender(list, isLoadMore) {
      if (!isLoadMore) {
        list.innerHTML = '';
        return;
      }

      const oldMoreBtn = list.querySelector('.load-more-btn');
      if (oldMoreBtn) oldMoreBtn.remove();
    },

    _getNoteDisplayTitle(note) {
      let displayTitle = note.title || '无标题';
      if (displayTitle.includes('_')) {
        displayTitle = displayTitle.split('_').slice(1).join('_').trim();
      }
      return displayTitle || '无标题';
    },

    _createNoteElement(note) {
      const element = document.createElement('div');
      element.className = `note-item ${note.id.toString() === this.activeId?.toString() ? 'active' : ''}`;

      const displayTitle = this._getNoteDisplayTitle(note);
      element.dataset.id = note.id;
      element.dataset.title = displayTitle;
      element.dataset.fullTitle = note.title;

      const checkbox = this.batchMode
        ? `<input type="checkbox" class="note-checkbox" ${this.selectedIds.has(note.id.toString()) ? 'checked' : ''}>`
        : '';
      const actionButtons = !this.batchMode
        ? `<span class="note-action-share" title="分享">${NOTE_SHARE_ICON}</span><span class="note-action-delete" title="删除">${NOTE_DELETE_ICON}</span>`
        : '';

      element.innerHTML = `${checkbox}<div class="note-info" title="双击编辑标题">${displayTitle}</div>${actionButtons}`;
      return element;
    },

    _finishListRender(list, filtered, limit, query, currentScroll, isLoadMore) {
      if (!isLoadMore && currentScroll > 0) {
        list.scrollTop = currentScroll;
      }

      if (filtered.length === 0 && !isLoadMore) {
        list.innerHTML = `<div class="empty-state-illustrated">
                <div class="empty-state-icon">✎</div>
                <div class="empty-state-title">没有找到笔记</div>
            </div>`;
      }

      if (filtered.length > limit && !query) {
        const moreBtn = document.createElement('div');
        moreBtn.className = 'load-more-btn';
        moreBtn.textContent = `加载更多 (${filtered.length - limit})...`;
        moreBtn.onclick = (e) => {
          e.stopPropagation();
          this.render(limit + 50, true, true);
        };
        list.appendChild(moreBtn);
      }

      if (!this._hasListEventDelegation) {
        this._setupListEventDelegation(list);
        this._hasListEventDelegation = true;
      }
    },

    _renderFlatNotes(list, displayNotes, filtered, limit, query, currentScroll, isLoadMore) {
      this._prepareListForRender(list, isLoadMore);

      const fragment = document.createDocumentFragment();

      for (const note of displayNotes) {
        if (list.querySelector(`.note-item[data-id="${note.id}"]`)) continue;

        fragment.appendChild(this._createNoteElement(note));
      }

      list.appendChild(fragment);
      this._finishListRender(list, filtered, limit, query, currentScroll, isLoadMore);
    },

    _setupListEventDelegation(list) {
      if (this._listEventHandler) {
        list.removeEventListener('click', this._listEventHandler);
      }

      this._listEventHandler = (e) => {
        const loadMoreBtn = e.target.closest('.load-more-btn');
        if (loadMoreBtn) {
          e.stopPropagation();
          const currentCount = list.querySelectorAll('.note-item').length;
          this.render(currentCount + 50, true, true);
          return;
        }

        const noteItem = e.target.closest('.note-item');
        if (!noteItem) return;

        const noteId = noteItem.dataset.id;

        if (e.target.classList.contains('note-checkbox')) {
          e.stopPropagation();
          this.toggleSelect(noteId, e);
          return;
        }

        if (e.target.closest('.note-action-share')) {
          e.stopPropagation();
          api.shareNoteById(noteId);
          return;
        }

        if (e.target.closest('.note-action-delete')) {
          e.stopPropagation();
          ui.del(noteId);
          return;
        }

        this.switch(noteId);
        if (window.innerWidth <= 768) {
          this.toggleSidebar();
        }
      };

      this._dblClickHandler = (e) => {
        const noteInfo = e.target.closest('.note-info');
        if (!noteInfo) return;

        const noteItem = noteInfo.closest('.note-item');
        if (!noteItem) return;

        e.stopPropagation();
        this.editNoteTitle(noteItem.dataset.id, noteItem.dataset.fullTitle);
      };

      list.addEventListener('click', this._listEventHandler);
      list.addEventListener('dblclick', this._dblClickHandler);
    },

    debounceRender() {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.render(9999, true), 200);
    },

    toggleFolder(folder) {
      if (this.collapsedFolders.has(folder)) {
        this.collapsedFolders.delete(folder);
      } else {
        this.collapsedFolders.add(folder);
      }
      this.render(9999, true);
    },

    toggleCategoryView() {
      this.showCategories = !this.showCategories;

      const toggleBtn = document.getElementById('category-toggle-btn');
      if (toggleBtn) {
        toggleBtn.classList.toggle('active', this.showCategories);
        toggleBtn.setAttribute('aria-pressed', this.showCategories ? 'true' : 'false');
      }

      if (this.showCategories) {
        const q = document.getElementById('search').value.toLowerCase();
        const filtered = this._getFilteredNotes(q);
        this.collapsedFolders = new Set(filtered.map((note) => this._getNoteFolder(note)));
      } else {
        this.collapsedFolders.clear();
      }

      this.render(9999, true);
    },

    toggleBatchMode() {
      this.batchMode = !this.batchMode;
      this.selectedIds.clear();
      document.getElementById('sidebar').classList.toggle('batch-mode', this.batchMode);
      document.getElementById('batch-bar').style.display = this.batchMode ? 'flex' : 'none';
      if (this.batchMode) {
        const selectAllCheckbox = document.getElementById('batch-select-all');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
      }
      this.render(undefined, true);
    },

    toggleSelect(id, e) {
      e.stopPropagation();
      const sid = id.toString();

      if (this.selectedIds.has(sid)) {
        this.selectedIds.delete(sid);
      } else {
        this.selectedIds.add(sid);
      }

      requestAnimationFrame(() => {
        document.getElementById('batch-count').innerText = `已选 ${this.selectedIds.size}`;
        this.updateSelectAllCheckbox();
      });
    },

    batchSelectAll(checked) {
      if (checked) {
        this.notes.forEach((note) => {
          if (!note.deleted) {
            this.selectedIds.add(note.id.toString());
          }
        });
      } else {
        this.selectedIds.clear();
      }

      document.getElementById('batch-count').innerText = `已选 ${this.selectedIds.size}`;
      this.render();
    },

    updateSelectAllCheckbox() {
      const selectAllCheckbox = document.getElementById('batch-select-all');
      if (!selectAllCheckbox) return;

      const totalNotes = this.notes.filter((note) => !note.deleted).length;
      const selectedCount = this.selectedIds.size;

      if (selectedCount === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
      } else if (selectedCount === totalNotes) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
      } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
      }
    },

    async batchDelete() {
      if (this.selectedIds.size === 0) return;
      const selectedCount = this.selectedIds.size;
      if (!confirm(`确定删除选中的 ${selectedCount} 篇笔记？`)) return;

      this.updateStatus('working', '删除中...');

      try {
        const res = await fetch('/api/notes/batch-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: Array.from(this.selectedIds),
          }),
        });

        if (res.ok) {
          this.notes = this.notes.filter((note) => !this.selectedIds.has(note.id.toString()));

          requestAnimationFrame(() => {
            this.toggleBatchMode();
            this.render();
            this.showToast(`已批量删除 ${selectedCount} 篇笔记`);
            this.updateStatus('success', '已删除');
            setTimeout(() => {
              this.updateStatus('idle', '就绪');
            }, 1500);
          });
        } else {
          this.showToast('批量删除失败，请检查网络连接');
          this.updateStatus('error', '删除失败');
        }
      } catch (error) {
        this.showToast('批量删除失败，请检查网络连接');
        this.updateStatus('error', '删除失败');
      }
    },

    async editNoteTitle(noteId, currentTitle) {
      const noteItem = document.querySelector(`.note-item[data-id="${noteId}"]`);
      if (!noteItem) return;

      const noteInfo = noteItem.querySelector('.note-info');
      if (!noteInfo) return;

      const originalHTML = noteInfo.innerHTML;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentTitle;
      input.className = 'title-edit-input';
      input.style.cssText = `
            width: 100%;
            padding: 4px 8px;
            border: 2px solid var(--primary, #4CAF50);
            border-radius: 4px;
            font-size: inherit;
            font-family: inherit;
            background: var(--bg, #fff);
            color: var(--text, #333);
            outline: none;
            box-sizing: border-box;
        `;

      noteInfo.innerHTML = '';
      noteInfo.appendChild(input);
      input.focus();
      input.select();

      const saveTitle = async () => {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== currentTitle) {
          const idx = this.notes.findIndex((note) => note.id.toString() === noteId.toString());
          if (idx !== -1) {
            const now = Math.floor(Date.now() / 1000);
            this.notes[idx] = {
              ...this.notes[idx],
              title: newTitle,
              updatedAt: now,
            };

            await this.saveToCloud(this.notes[idx]);
            this.render();
          }
        } else {
          noteInfo.innerHTML = originalHTML;
        }
      };

      input.addEventListener('blur', saveTitle);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        } else if (e.key === 'Escape') {
          input.value = currentTitle;
          input.blur();
        }
      });
    },

    async batchMove() {
      if (this.selectedIds.size === 0) return;

      const folderName = prompt('请输入目标目录名称（留空则移至根目录）：', '');
      if (folderName === null) return;

      const cleanFolderName = folderName.trim().replace(/_/g, '');
      const now = Math.floor(Date.now() / 1000);
      const selectedCount = this.selectedIds.size;
      const selectedIdList = Array.from(this.selectedIds);
      const activeIdStr = this.activeId ? this.activeId.toString() : null;
      let updatedActiveNote = null;

      this.notes = this.notes.map((note) => {
        const noteId = note.id.toString();
        if (selectedIdList.includes(noteId)) {
          const pureTitle = note.title.includes('_') ? note.title.split('_').pop() : note.title;
          const newTitle = cleanFolderName ? `${cleanFolderName}_${pureTitle}` : pureTitle;
          const updatedNote = { ...note, title: newTitle, updatedAt: now, isUnsynced: true };

          if (noteId === activeIdStr) {
            updatedActiveNote = updatedNote;
          }

          return updatedNote;
        }
        return note;
      });

      for (const note of this.notes) {
        if (note.isUnsynced) {
          await this.saveToCloud(note);
        }
      }

      if (updatedActiveNote && this.editor) {
        if (this.editor.setValue) {
          this.editor.setValue(updatedActiveNote.content || '');
        }
        this.updatePreview();
      }

      this.render(undefined, true);
      this.toggleBatchMode();
      this.showToast(`已成功移动 ${selectedCount} 篇笔记`);
    },
  });
}
