window.createCalendarImportExportHandlers = function createCalendarImportExportHandlers(dependencies) {
  const getHandlers = () => dependencies.handlers;
  return {
    showExportMenu: (event) => {
      // 创建下拉菜单
      const existingMenu = document.getElementById('export-dropdown-menu');
      if (existingMenu) {
        existingMenu.remove();
        return;
      }

      const menu = document.createElement('div');
      menu.id = 'export-dropdown-menu';
      menu.style.cssText = `
        position: fixed;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        min-width: 160px;
        padding: 4px 0;
      `;

      const options = [
        { label: '日历事件 (.ics)', action: 'calendar' },
        { label: '待办事项 (.json)', action: 'todos' },
        { label: '提醒设置 (.json)', action: 'reminders' }
      ];

      options.forEach(opt => {
        const item = document.createElement('div');
        item.textContent = opt.label;
        item.style.cssText = `
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          color: var(--text);
          transition: background 0.15s;
        `;
        item.onmouseenter = () => item.style.background = 'var(--side)';
        item.onmouseleave = () => item.style.background = 'transparent';
        item.onclick = () => {
          getHandlers().exportData(opt.action);
          menu.remove();
        };
        menu.appendChild(item);
      });

      // 定位菜单
      const rect = event.target.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.left = `${rect.left}px`;

      document.body.appendChild(menu);

      // 点击其他地方关闭菜单
      const closeMenu = (e) => {
        if (!menu.contains(e.target) && e.target !== event.target) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      };
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    },

    async exportData(type) {
      try {
        if (type === 'calendar') {
          // 导出日历事件
          const response = await fetch('/api/events/export', {
            credentials: 'include'
          });

          if (!response.ok) {
            if (response.status === 401) {
              alert('请先登录后再导出日历');
              window.location.href = '/login.html';
              return;
            }
            throw new Error('导出失败');
          }

          const icsContent = await response.text();
          const blob = new Blob([icsContent], { type: 'text/calendar' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `z7note-calendar-${new Date().toISOString().split('T')[0]}.ics`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          alert('日历导出成功!');
        } else if (type === 'todos') {
          // 导出待办事项
          const response = await fetch('/api/todos', {
            credentials: 'include'
          });

          if (!response.ok) throw new Error('导出失败');

          const todos = await response.json();
          const todosData = {
            username: 'export',
            exportTime: new Date().toISOString(),
            todos: todos.map(todo => ({
              id: todo.id,
              title: todo.title,
              description: todo.description,
              completed: todo.completed === 1,
              priority: todo.priority,
              dueDate: todo.dueDate ? new Date(todo.dueDate * 1000).toISOString() : null,
              updatedAt: new Date(todo.updatedAt * 1000).toISOString()
            }))
          };

          const blob = new Blob([JSON.stringify(todosData, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `z7note-todos-${new Date().toISOString().split('T')[0]}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          alert('待办事项导出成功!');
        } else if (type === 'reminders') {
          // 导出提醒设置
          const response = await fetch('/api/reminders', {
            credentials: 'include'
          });

          if (!response.ok) throw new Error('导出失败');

          const settings = await response.json();
          const remindersData = {
            username: 'export',
            exportTime: new Date().toISOString(),
            reminders: settings
          };

          const blob = new Blob([JSON.stringify(remindersData, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `z7note-reminders-${new Date().toISOString().split('T')[0]}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          alert('提醒设置导出成功!');
        }
      } catch (error) {
        console.error('导出失败:', error);
        alert('导出失败,请重试');
      }
    },

    async importCalendar(e) {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const icsContent = await file.text();
        const response = await fetch('/api/events/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ icsContent })
        });

        if (!response.ok) {
          throw new Error('导入失败');
        }

        const result = await response.json();

        if (result.success) {
          let message = `导入成功！\n`;
          message += `新增：${result.imported} 条\n`;
          if (result.updated > 0) {
            message += `更新：${result.updated} 条\n`;
          }
          if (result.skipped > 0) {
            message += `跳过重复：${result.skipped} 条`;
          }
          alert(message);

          dependencies.render.calendar();
          dependencies.sidebarRenderer.refresh();
        }
      } catch (error) {
        console.error('导入日历失败:', error);
        alert('导入失败,请检查文件格式');
      } finally {
        e.target.value = '';
      }
    },

    showImportMenu: (event) => {
      // 创建下拉菜单
      const existingMenu = document.getElementById('import-dropdown-menu');
      if (existingMenu) {
        existingMenu.remove();
        return;
      }

      const menu = document.createElement('div');
      menu.id = 'import-dropdown-menu';
      menu.style.cssText = `
        position: fixed;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        min-width: 160px;
        padding: 4px 0;
      `;

      const options = [
        { label: '日历事件 (.ics)', id: 'ics-file-input' },
        { label: '待办事项 (.json)', id: 'todos-file-input' },
        { label: '提醒设置 (.json)', id: 'reminders-file-input' }
      ];

      options.forEach(opt => {
        const item = document.createElement('div');
        item.textContent = opt.label;
        item.style.cssText = `
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          color: var(--text);
          transition: background 0.15s;
        `;
        item.onmouseenter = () => item.style.background = 'var(--side)';
        item.onmouseleave = () => item.style.background = 'transparent';
        item.onclick = () => {
          const fileInput = document.getElementById(opt.id);
          if (fileInput) fileInput.click();
          menu.remove();
        };
        menu.appendChild(item);
      });

      // 定位菜单
      const rect = event.target.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.left = `${rect.left}px`;

      document.body.appendChild(menu);

      // 点击其他地方关闭菜单
      const closeMenu = (e) => {
        if (!menu.contains(e.target) && e.target !== event.target) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      };
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    },

    async importTodos(e) {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const todosData = JSON.parse(text);

        const response = await fetch('/api/todos/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ todosData })
        });

        if (!response.ok) {
          throw new Error('导入失败');
        }

        const result = await response.json();

        if (result.success) {
          let message = `导入成功！\n`;
          message += `新增：${result.imported} 条\n`;
          if (result.updated > 0) {
            message += `更新：${result.updated} 条\n`;
          }
          if (result.skipped > 0) {
            message += `跳过重复：${result.skipped} 条`;
          }
          alert(message);

          dependencies.render.calendar();
          dependencies.sidebarRenderer.refresh();
        }
      } catch (error) {
        console.error('导入待办失败:', error);
        alert('导入失败，请检查文件格式');
      } finally {
        e.target.value = '';
      }
    },

    async importReminders(e) {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const remindersData = JSON.parse(text);

        const response = await fetch('/api/reminders/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ remindersData })
        });

        if (!response.ok) {
          throw new Error('导入失败');
        }

        const result = await response.json();

        if (result.success) {
          alert('提醒设置导入成功！');
        }
      } catch (error) {
        console.error('导入提醒设置失败:', error);
        alert('导入失败，请检查文件格式');
      } finally {
        e.target.value = '';
      }
    },
  };
};
