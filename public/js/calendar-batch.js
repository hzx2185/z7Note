(function() {
  window.createCalendarBatchHandlers = function(dependencies) {
    const { state, utils, api, render, sidebarRenderer, dataLoader } = dependencies;

    return {
    // 批量添加相关方法
    openBatchTextModal() {
      const modal = document.getElementById('batch-text-modal');
      if (modal) {
        // 重置状态
        document.getElementById('batch-text-input').value = '';
        document.getElementById('batch-preview-area').style.display = 'none';
        document.getElementById('batch-preview-list').innerHTML = '';
        const importBtn = document.getElementById('batch-import-btn');
        importBtn.disabled = true;
        importBtn.textContent = '导入';

        modal.classList.add('show');
        document.getElementById('batch-text-input').focus();
      }
    },

    closeBatchTextModal() {
      const modal = document.getElementById('batch-text-modal');
      if (modal) {
        modal.classList.remove('show');
        document.getElementById('batch-text-input').value = '';
        document.getElementById('batch-preview-area').style.display = 'none';
        document.getElementById('batch-preview-list').innerHTML = '';
        const importBtn = document.getElementById('batch-import-btn');
        importBtn.disabled = true;
        importBtn.textContent = '导入';
      }
    },

    previewBatchText() {
      try {
        const textInput = document.getElementById('batch-text-input');
        if (!textInput) return;

        const text = textInput.value;
        if (!text.trim()) {
          alert('请输入要添加的内容');
          return;
        }

        const results = utils.parseBatchInput(text);
        const list = document.getElementById('batch-preview-list');
        const importBtn = document.getElementById('batch-import-btn');
        const previewArea = document.getElementById('batch-preview-area');

        list.innerHTML = '';
        if (results.length > 0) {
          results.forEach(item => {
            const div = document.createElement('div');
            div.style.padding = '4px 8px';
            div.style.borderBottom = '1px solid var(--border)';
            div.style.fontSize = '12px';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.gap = '8px';
            div.style.whiteSpace = 'nowrap';
            div.style.overflow = 'hidden';

            const dateSpan = document.createElement('span');
            dateSpan.style.color = 'var(--accent)';
            dateSpan.style.fontFamily = 'monospace';
            dateSpan.style.flexShrink = '0';
            dateSpan.style.width = '80px';
            dateSpan.textContent = item.date;

            const titleSpan = document.createElement('span');
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';
            titleSpan.textContent = item.title;

            div.appendChild(dateSpan);
            div.appendChild(titleSpan);
            list.appendChild(div);
          });
          previewArea.style.display = 'block';
          previewArea.classList.remove('hidden'); // 确保移除 hidden 类
          importBtn.disabled = false;
          importBtn.textContent = `导入 (${results.length}项)`;
          importBtn.dataset.items = JSON.stringify(results);
        } else {
          previewArea.style.display = 'none';
          importBtn.disabled = true;
          importBtn.textContent = '导入';
          alert('未识别到有效内容，请确保格式为: 日期 标题\n例如: 3.15 买菜');
        }
      } catch (error) {
        console.error('预览失败:', error);
        alert('预览功能出错，请查看控制台日志');
      }
    },
    async importBatchText() {
      const btn = document.getElementById('batch-import-btn');
      const items = JSON.parse(btn.dataset.items || '[]');
      const type = document.querySelector('input[name="batch-type"]:checked').value;

      if (items.length === 0) return;

      btn.disabled = true;
      btn.textContent = '导入中...';
      state.isImporting = true;

      try {
        let result;
        if (type === 'event') {
          const eventsData = items.map(item => ({
            title: item.title,
            startTime: `${item.date}T00:00`,
            endTime: `${item.date}T23:59`,
            allDay: true,
            description: '批量导入'
          }));

          result = await api.request('/api/events/batch', {
            method: 'POST',
            body: JSON.stringify({ events: eventsData })
          });
        } else {
          const todosData = items.map(item => ({
            title: item.title,
            dueDate: `${item.date}T23:59`,
            priority: 2,
            allDay: true,
            description: '批量导入'
          }));

          result = await api.request('/api/todos/import', {
            method: 'POST',
            body: JSON.stringify({ todosData: { todos: todosData } })
          });
        }

        const successCount = result.count || result.imported || items.length;
        alert(`成功导入 ${successCount} 项`);

        this.closeBatchTextModal();
        render.calendar();
        sidebarRenderer.refresh();
      } catch (error) {
        console.error('批量导入失败:', error);
        alert('导入失败: ' + error.message);
      } finally {
        state.isImporting = false;
        btn.disabled = false;
        btn.textContent = '导入';
      }
    },

    // 批量选择相关方法
    toggleBatchSelect() {
      state.batchSelect.enabled = !state.batchSelect.enabled;
      state.batchSelect.selectedItems.clear();

      const batchActionsBar = document.getElementById('batch-actions-bar');
      const batchSelectBtn = document.getElementById('batch-select-btn');

      if (state.batchSelect.enabled) {
        batchActionsBar.style.display = 'flex';
        batchSelectBtn.style.background = 'var(--accent)';
        batchSelectBtn.style.color = 'white';
      } else {
        batchActionsBar.style.display = 'none';
        batchSelectBtn.style.background = '';
        batchSelectBtn.style.color = '';
      }

      // 重新渲染侧边栏
      sidebarRenderer.refresh();
    },

    toggleItemSelection(id, type) {
      const key = `${type}_${id}`;
      if (state.batchSelect.selectedItems.has(key)) {
        state.batchSelect.selectedItems.delete(key);
      } else {
        state.batchSelect.selectedItems.add(key);
      }

      // 更新选中计数
      const selectedCount = document.getElementById('selected-count');
      selectedCount.textContent = `${state.batchSelect.selectedItems.size}项`;

      // 更新全选复选框状态
      const selectAllCheckbox = document.getElementById('select-all-checkbox');
      const visibleItems = document.querySelectorAll('.batch-checkbox');
      const checkedItems = document.querySelectorAll('.batch-checkbox:checked');
      selectAllCheckbox.checked = visibleItems.length > 0 && visibleItems.length === checkedItems.length;
    },

    toggleSelectAll(checked) {
      const visibleItems = document.querySelectorAll('.batch-checkbox');
      visibleItems.forEach(checkbox => {
        checkbox.checked = checked;
        const id = checkbox.dataset.id;
        const type = checkbox.dataset.type;
        const key = `${type}_${id}`;

        if (checked) {
          state.batchSelect.selectedItems.add(key);
        } else {
          state.batchSelect.selectedItems.delete(key);
        }
      });

      // 更新选中计数
      const selectedCount = document.getElementById('selected-count');
      selectedCount.textContent = `${state.batchSelect.selectedItems.size}项`;
    },

    async batchDelete() {
      if (state.batchSelect.selectedItems.size === 0) {
        alert('请先选择要删除的项目');
        return;
      }

      if (!(await this.showConfirm(`确定要删除选中的 ${state.batchSelect.selectedItems.size} 个项目吗？`))) {
        return;
      }

      try {        const eventIds = [];
        const todoIds = [];
        const noteIds = [];

        state.batchSelect.selectedItems.forEach(key => {
          const [type, id] = key.split('_');
          if (type === 'event') eventIds.push(id);
          else if (type === 'todo') todoIds.push(id);
          else if (type === 'note') noteIds.push(id);
        });

        const promises = [];
        if (eventIds.length > 0) {
          promises.push(fetch('/api/events/batch', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: eventIds })
          }));
        }

        // 待办和笔记目前还是循环删除或需要对应的batch接口
        todoIds.forEach(id => promises.push(api.deleteTodo(id)));

        await Promise.all(promises);

        // 清空选择并刷新
        state.batchSelect.selectedItems.clear();
        this.toggleBatchSelect();

        state.sidebar.dataByDate.clear();
        sidebarRenderer.refresh();
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());

        alert('批量删除成功');
      } catch (error) {
        console.error('批量删除失败:', error);
        alert('批量删除失败,请重试');
      }
    },

    async clearAllEvents() {
      if (!(await this.showConfirm('确定要清空所有日历事件吗？此操作不可恢复！'))) {
        return;
      }
      if (!(await this.showConfirm('请再次确认：清空全部日历事件？'))) {
        return;
      }

      try {
        const res = await fetch('/api/events/batch', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true })
        });

        if (res.ok) {
          state.batchSelect.selectedItems.clear();
          if (state.batchSelect.enabled) this.toggleBatchSelect();
          state.sidebar.dataByDate.clear();
          sidebarRenderer.refresh();
          dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
          alert('所有事件已清空');
        } else {
          throw new Error('清空失败');
        }
      } catch (error) {
        alert('操作失败: ' + error.message);
      }
    },

    async formatData() {
      if (!(await this.showConfirm('将对所有日历事件进行规范化修复（修复时间戳格式、清理非法字符等），是否继续？'))) {
        return;
      }

      try {
        const res = await fetch('/api/events/format', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (res.ok) {
          const result = await res.json();
          alert(`修复完成！共修复 ${result.fixedCount} 条数据。`);
          state.sidebar.dataByDate.clear();
          sidebarRenderer.refresh();
          dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
        } else {
          throw new Error('修复失败');
        }
      } catch (error) {
        alert('操作失败: ' + error.message);
      }
    },

    async cleanupDuplicates() {
      if (!(await this.showConfirm('将自动查找并删除标题和时间完全相同的重复事件，是否继续？'))) {
        return;
      }

      try {
        const res = await fetch('/api/events/cleanup-duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (res.ok) {
          const result = await res.json();
          alert(`去重完成！共删除 ${result.deletedCount} 条重复数据。`);
          state.sidebar.dataByDate.clear();
          sidebarRenderer.refresh();
          dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
        } else {
          throw new Error('去重失败');
        }
      } catch (error) {
        alert('操作失败: ' + error.message);
      }
    },
    };
  };
})();
