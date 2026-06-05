import { loadMemberTiers } from './member-data.js';

export function enhanceUIAccountPanel(UIManager) {
  Object.assign(UIManager, {
    _isLoadingUserInfo: false,
    planCapabilities: {},

    applyPlanCapabilityVisibility(capabilities = {}, userInfo = {}) {
      this.planCapabilities = capabilities;

      const toggle = (id, visible) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.style.display = visible ? '' : 'none';
        if ('disabled' in element) {
          element.disabled = !visible;
        }
      };

      toggle('nav-calendar-btn', capabilities.calendarEnabled !== false);
      toggle('nav-contacts-btn', capabilities.contactsEnabled !== false);
      toggle('nav-notes-btn', capabilities.notesEnabled !== false);
      toggle('notes-export-btn', capabilities.importExport !== false);
        toggle('notes-import-btn', capabilities.importExport !== false);
        toggle('backup-config-btn', capabilities.backupExportEnabled !== false && capabilities.webdavEnabled !== false);
        toggle('shares-link', capabilities.noteSharingEnabled !== false || capabilities.fileSharingEnabled !== false);
        toggle('attachment-manager-btn', capabilities.attachmentManageEnabled !== false && capabilities.attachmentsEnabled !== false);
    },

    async loadUserInfo() {
      if (this._isLoadingUserInfo) {
        return;
      }

      this._isLoadingUserInfo = true;

      const formatSize = (mb) => {
        const bytes = parseFloat(mb) * 1024 * 1024;
        if (bytes === 0) return '0B';
        if (bytes < 1024) return `${bytes.toFixed(0)}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${parseFloat(mb).toFixed(2)}MB`;
      };

      try {
        await loadMemberTiers().catch(() => {});
        const res = await fetch('/api/user-info', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load user info');
        const data = await res.json();

        const userDisplay = document.getElementById('user-display');
        if (userDisplay) {
          userDisplay.textContent = data.username || '我的账户';
        }

        if (data.username) {
          localStorage.setItem('z7note_username', data.username);
        }

        if (window.tools?.loadToolbarLayout) {
          window.tools.loadToolbarLayout({ force: true });
        }

        this.applyPlanCapabilityVisibility(data.planCapabilities || {}, data);

        const noteUsageText = document.getElementById('note-usage-text');
        const noteBar = document.getElementById('note-bar');
        if (noteUsageText && noteBar && data.noteLimit) {
          const noteUsageMB = parseFloat(data.noteUsage || 0);
          const notePercent = Math.min((noteUsageMB / data.noteLimit) * 100, 100);

          noteUsageText.textContent = `${formatSize(noteUsageMB)}/${Math.round(data.noteLimit)}MB`;

          const noteContainer = noteUsageText.parentElement;
          if (noteContainer) {
            noteContainer.title = `笔记: ${data.noteCount || 0} | 联系人: ${data.contactCount || 0} | 日历: ${data.eventCount || 0} | 待办: ${data.todoCount || 0}`;
            const label = noteContainer.previousSibling;
            if (label && label.nodeType === 3 && label.textContent.includes('笔记:')) {
              label.textContent = label.textContent.replace('笔记:', '数据:');
            }
          }

          noteBar.style.width = `${notePercent}%`;
        }

        const fileUsageText = document.getElementById('file-usage-text');
        const fileBar = document.getElementById('file-bar');
        if (fileUsageText && fileBar && data.fileLimit) {
          const fileUsageMB = parseFloat(data.fileUsage || 0);
          const filePercent = Math.min((fileUsageMB / data.fileLimit) * 100, 100);

          fileUsageText.textContent = `${formatSize(fileUsageMB)}/${Math.round(data.fileLimit)}MB`;
          fileBar.style.width = `${filePercent}%`;
        }

        if (data.attachmentPreviewConfig) {
          this.attachmentPreviewConfig = {
            ...this.attachmentPreviewConfig,
            ...data.attachmentPreviewConfig
          };
        }
      } catch (e) {
        console.error('加载用户信息失败:', e);
      } finally {
        this._isLoadingUserInfo = false;
      }
    },

    refreshUserInfo() {
      clearTimeout(this._refreshUserInfoTimer);
      this._refreshUserInfoTimer = setTimeout(() => {
        this.loadUserInfo();
      }, 500);
    },

    async logout() {
      const shouldLogout = confirm('确定要退出登录吗？');
      if (!shouldLogout) return;

      const clearCache = confirm('是否同时清除浏览器缓存？\n\n这将清除：\n- 本地存储数据（用户信息、设置等）\n- 会话存储数据\n- IndexedDB 数据库\n- Service Worker 缓存\n- Cache API 缓存\n\n建议定期清除缓存以保护隐私。');

      try {
        if (window.wsManager && window.wsManager.disconnect) {
          window.wsManager.disconnect();
        }

        await fetch('/api/logout', { method: 'POST' });

        if (clearCache) {
          localStorage.clear();
          sessionStorage.clear();

          if (window.indexedDB) {
            const databases = await indexedDB.databases();
            if (databases.length > 0) {
              for (const db of databases) {
                if (db.name) {
                  indexedDB.deleteDatabase(db.name);
                }
              }
            }
          }

          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            if (registrations.length > 0) {
              for (const registration of registrations) {
                await registration.unregister();
              }
            }
          }

          if ('caches' in window) {
            const cacheNames = await caches.keys();
            if (cacheNames.length > 0) {
              for (const cacheName of cacheNames) {
                await caches.delete(cacheName);
              }
            }
          }
        } else {
          localStorage.removeItem('z7note_username');
          localStorage.removeItem('username');
          localStorage.removeItem('p-theme');
          localStorage.removeItem('theme');
        }

        setTimeout(() => {
          window.location.href = '/login.html';
        }, 500);
      } catch (e) {
        console.error('[Logout] 退出失败:', e);

        if (window.wsManager && window.wsManager.disconnect) {
          window.wsManager.disconnect();
        }

        localStorage.removeItem('z7note_username');
        localStorage.removeItem('username');
        localStorage.removeItem('p-theme');
        localStorage.removeItem('theme');

        if (clearCache) {
          localStorage.clear();
          sessionStorage.clear();
        }

        setTimeout(() => {
          window.location.href = '/login.html';
        }, 500);
      }
    },

    showTrash() {
      const modal = document.getElementById('trash-modal');
      if (modal) {
        modal.classList.add('show');
        this.loadTrash();
      }
    },

    async loadTrash() {
      const listBody = document.getElementById('trash-list-body');
      listBody.innerHTML = '<div class="workspace-state-inline">加载中...</div>';

      try {
        const res = await fetch('/api/notes/trash');
        if (res.ok) {
          const notes = await res.json();
          if (notes.length === 0) {
            listBody.innerHTML = '<div class="workspace-state-inline">回收站为空</div>';
            return;
          }

          let html = '';
          for (const note of notes) {
            const noteIdStr = String(note.id);
            html += `
              <div class="trash-list-item">
                <div class="trash-list-copy">
                  <div class="trash-list-title">${note.title || '无标题'}</div>
                  <div class="trash-list-meta">${new Date(note.updatedAt > 10000000000 ? note.updatedAt : note.updatedAt * 1000).toLocaleString('zh-CN')}</div>
                </div>
                <div class="trash-list-actions">
                  <button class="btn restore-note-btn" data-note-id="${noteIdStr}">恢复</button>
                  <button class="btn delete-note-btn" data-note-id="${noteIdStr}">永久删除</button>
                </div>
              </div>`;
          }
          listBody.innerHTML = html;

          listBody.querySelectorAll('.restore-note-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              const noteId = e.target.getAttribute('data-note-id');
              this.restoreNote(noteId);
            });
          });

          listBody.querySelectorAll('.delete-note-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              const noteId = e.target.getAttribute('data-note-id');
              this.deleteNoteFromTrash(noteId);
            });
          });
        } else {
          const data = await res.json();
          listBody.innerHTML = `<div class="workspace-state-inline workspace-state-inline-danger">加载失败: ${data.error || '未知错误'}</div>`;
        }
      } catch (e) {
        console.error('[回收站] 加载失败:', e);
        listBody.innerHTML = `<div class="workspace-state-inline workspace-state-inline-danger">网络错误: ${e.message}</div>`;
      }
    },

    async restoreNote(id) {
      if (!confirm('确定要恢复这篇笔记吗？')) return;

      try {
        const res = await fetch(`/api/notes/${id}/restore`, { method: 'PUT' });
        if (res.ok) {
          this.showToast('笔记已恢复');
          this.loadTrash();
          const notesRes = await fetch('/api/files');
          if (notesRes.ok) {
            this.notes = await notesRes.json() || [];
            this.render();
          }
        } else {
          const data = await res.json();
          this.showToast(`恢复失败: ${data.error || '未知错误'}`, false);
        }
      } catch (e) {
        this.showToast('操作失败，请检查网络', false);
      }
    },

    async deleteNoteFromTrash(id) {
      if (!confirm('确定要永久删除这篇笔记吗？此操作不可撤销。')) return;

      try {
        const res = await fetch(`/api/notes/${id}/permanent`, { method: 'DELETE' });
        if (res.ok) {
          this.showToast('已永久删除');
          this.loadTrash();
          const notesRes = await fetch('/api/files');
          if (notesRes.ok) {
            this.notes = await notesRes.json() || [];
            this.render();
          }
        } else {
          const data = await res.json();
          this.showToast(`删除失败: ${data.error || '未知错误'}`, false);
        }
      } catch (e) {
        this.showToast('操作失败，请检查网络', false);
      }
    },

    async emptyTrash() {
      if (!confirm('确定要清空回收站吗？此操作不可撤销。')) return;
      try {
        const res = await fetch('/api/notes/trash/empty', { method: 'DELETE' });
        if (res.ok) {
          this.showToast('回收站已清空');
          this.loadTrash();
          const notesRes = await fetch('/api/files');
          if (notesRes.ok) {
            this.notes = await notesRes.json() || [];
            this.render();
          }
        } else {
          const data = await res.json();
          this.showToast(`清空失败: ${data.error || '未知错误'}`, false);
        }
      } catch (e) {
        this.showToast('操作失败，请检查网络', false);
      }
    }
  });
}
