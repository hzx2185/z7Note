window.createCalendarItemHandlers = function createCalendarItemHandlers(dependencies) {
  const { state, elements, utils, api, sidebarRenderer, dataLoader } = dependencies;

  return {
    buildCompletedTodoEventData(todo) {
      const eventData = {
        title: todo.title,
        description: todo.description || '',
        allDay: todo.allDay === 1,
        reminderEmail: todo.reminderEmail || 0,
        reminderBrowser: todo.reminderBrowser || 0,
        reminderCaldav: 0
      };

      const now = new Date();
      const sourceStart = todo.startTime || todo.dueDate || null;
      const sourceEnd = todo.dueDate || todo.startTime || null;

      if (eventData.allDay) {
        eventData.startTime = Math.floor(Date.UTC(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        ) / 1000);
        eventData.endTime = Math.floor(Date.UTC(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1
        ) / 1000);
        return eventData;
      }

      if (sourceStart) {
        const startDate = new Date(sourceStart * 1000);
        const duration = sourceEnd ? Math.max(0, sourceEnd - sourceStart) : 0;
        const completedStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          startDate.getHours(),
          startDate.getMinutes(),
          startDate.getSeconds(),
          0
        );

        eventData.startTime = Math.floor(completedStart.getTime() / 1000);
        eventData.endTime = eventData.startTime + duration;
        return eventData;
      }

      eventData.startTime = Math.floor(now.getTime() / 1000);
      eventData.endTime = eventData.startTime;
      return eventData;
    },

    async toggleTodo(id, completed) {
      try {
        // 如果是完成操作，检查是否需要自动转换为事件
        if (completed) {
          // 获取提醒设置
          const reminderSettings = await api.request('/api/reminders');

          if (reminderSettings && reminderSettings.todo_complete_to_event === 1) {
            // 获取待办详情
            const todo = state.allTodos.find(t => t.id === id);

            if (todo) {
              const eventData = this.buildCompletedTodoEventData(todo);

              // 创建事件
              await api.createEvent(eventData);

              // 如果设置要求删除原待办
              if (reminderSettings.delete_todo_after_convert !== 0) {
                await api.deleteTodo(id);
              } else {
                // 只标记为完成
                await api.toggleTodo(id, completed);
              }

              // 刷新数据
              await sidebarRenderer.updateIncompleteCount();
              await sidebarRenderer.loadAllTodos();
              dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
              return;
            }
          }
        }

        // 正常切换状态
        await api.toggleTodo(id, completed);

        // 更新未完成待办事项数量
        await sidebarRenderer.updateIncompleteCount();

        // 重新加载所有待办数据，确保侧边栏中所有日期的待办状态都是最新的
        await sidebarRenderer.loadAllTodos();
      } catch (error) {
        console.error('切换待办状态失败:', error);
      }
    },

    async deleteTodo(id) {
      if (!(await this.showConfirm('确定要删除这个待办事项吗？'))) return;

      try {
        await api.deleteTodo(id);

        // 更新未完成待办事项数量
        await sidebarRenderer.updateIncompleteCount();

        // 重新加载所有待办数据
        await sidebarRenderer.loadAllTodos();

        // 更新月视图
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('删除待办事项失败:', error);
      }
    },

    // 将待办转换为事件
    async convertTodoToEvent(todo) {
      const result = await this.showConfirm('确定要将此待办转换为事件吗？', {
        showCheckbox: true,
        checkboxLabel: '转换后删除原待办',
        checkboxChecked: true
      });

      if (!result || !result.confirmed) return;

      try {
        const eventData = this.buildCompletedTodoEventData(todo);

        // 创建事件
        await api.createEvent(eventData);

        // 如果勾选了删除
        if (result.checked) {
          await api.deleteTodo(todo.id);
        }

        // 刷新数据
        await sidebarRenderer.updateIncompleteCount();
        await sidebarRenderer.loadAllTodos();
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());

        // 显示成功提示
        alert('已成功转换为事件');
      } catch (error) {
        console.error('转换待办为事件失败:', error);
        alert('转换失败: ' + (error.message || '请重试'));
      }
    },

    editTodo(todo) {
      elements.todoForm.querySelector('[name="title"]').value = todo.title || '';
      elements.todoForm.querySelector('[name="description"]').value = todo.description || '';
      elements.todoForm.querySelector('[name="priority"]').value = todo.priority || 2;

      const allDay = todo.allDay === 1;
      elements.todoForm.querySelector('[name="allDay"]').value = allDay ? 'true' : 'false';

      if (allDay) {
        // 全天待办：如果没有 startTime，则使用 dueDate 作为开始日期
        const startInfo = utils.getAllDayDisplayDate(todo.startTime || todo.dueDate, false);
        const dueInfo = utils.getAllDayDisplayDate(todo.dueDate, false);
        elements.todoForm.querySelector('[name="startDate"]').value = startInfo ? startInfo.str : '';
        elements.todoForm.querySelector('[name="dueDateDate"]').value = dueInfo ? dueInfo.str : '';
        this.updateTodoAllDayUI(true);
      } else {
        // 非全天待办：如果没有 startTime，则使用 dueDate 作为开始时间
        elements.todoForm.querySelector('[name="startTime"]').value = todo.startTime ? utils.toLocalISO(todo.startTime) : (todo.dueDate ? utils.toLocalISO(todo.dueDate) : '');
        elements.todoForm.querySelector('[name="dueDate"]').value = todo.dueDate ? utils.toLocalISO(todo.dueDate) : '';
        this.updateTodoAllDayUI(false);
      }

      // 显式回填待办提醒勾选状态
      const reminderEmailInput = elements.todoForm.querySelector('[name="reminderEmail"]');
      const reminderBrowserInput = elements.todoForm.querySelector('[name="reminderBrowser"]');

      if (reminderEmailInput) reminderEmailInput.checked = todo.reminderEmail === 1;
      if (reminderBrowserInput) reminderBrowserInput.checked = todo.reminderBrowser === 1;
      this.syncReminderPresetOptions('todo-reminderPreset', allDay);
      this.setReminderPresetValue(
        'todo-reminderPreset',
        todo.reminderPreset || this.getDefaultReminderPreset(allDay),
        false
      );

      elements.todoForm.dataset.todoId = todo.id;
      const modalTitle = elements.todoModal.querySelector('.modal-title');
      if (modalTitle) modalTitle.textContent = '编辑待办事项';

      this.openTodoModal();
    },

    async deleteEvent(id) {
      if (id && typeof id === 'string') {
        // 处理订阅日历事件 (由系统同步，通常不支持直接删除单个事件)
        if (id.startsWith('sub_')) {
          alert('这是订阅日历中的事件。订阅事件会自动随源同步，无法直接在此删除。如需移除，请在“订阅管理”中删除该订阅。');
          return;
        }

        // 处理重复事件实例 (例如: ID_时间戳)
        if (id.includes('_')) {
          const lastUnderscoreIndex = id.lastIndexOf('_');
          const originalId = id.slice(0, lastUnderscoreIndex);
          const occurrenceStartTime = Number(id.slice(lastUnderscoreIndex + 1));

          const summary = await this.getRecurringDeleteSummary(originalId, occurrenceStartTime);
          const previousCount = summary?.previous ?? 0;
          const currentCount = 1;
          const futureCount = summary?.future ?? 0;

          const deleteScope = await this.showConfirm('这是重复事件。请选择删除范围：', {
            confirmLabel: '确定删除',
            cancelLabel: '取消',
            defaultCheckedValues: ['current', 'future'],
            checkboxChoices: [
              { value: 'previous', label: `之前 ${previousCount} 个` },
              { value: 'current', label: `本次 ${currentCount} 个` },
              { value: 'future', label: `未来 ${futureCount} 个` }
            ]
          });

          if (Array.isArray(deleteScope) && deleteScope.length > 0) {
            try {
              await api.deleteRecurringEvent(originalId, {
                occurrenceStartTime,
                deletePrevious: deleteScope.includes('previous'),
                deleteCurrent: deleteScope.includes('current'),
                deleteFuture: deleteScope.includes('future')
              });
              sidebarRenderer.refresh();
              dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
            } catch (error) {
              console.error('删除事件失败:', error);
              alert('删除失败，请重试');
            }
          }
          return;
        }
      }

      if (!(await this.showConfirm('确定要删除此事件？'))) return;

      try {
        await api.deleteEvent(id);
        sidebarRenderer.refresh();
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('删除事件失败:', error);
        alert('删除失败，请重试');
      }

    },

    editEvent(event) {
      let eventId = event.id;
      if (event.isRecurringInstance && event._originalId) {
        eventId = event._originalId;
      }

      elements.eventForm.querySelector('[name="title"]').value = event.title || '';
      elements.eventForm.querySelector('[name="description"]').value = event.description || '';
      elements.eventForm.querySelector('[name="startTime"]').value = utils.toLocalISO(event.startTime);
      elements.eventForm.querySelector('[name="endTime"]').value = event.endTime ? utils.toLocalISO(event.endTime) : '';
        elements.eventForm.querySelector('[name="allDay"]').value = event.allDay ? 'true' : 'false';

      // 显式回填提醒勾选状态
      const reminderEmailInput = elements.eventForm.querySelector('[name="reminderEmail"]');
      const reminderBrowserInput = elements.eventForm.querySelector('[name="reminderBrowser"]');
      const reminderCaldavInput = elements.eventForm.querySelector('[name="reminderCaldav"]');

      if (reminderEmailInput) reminderEmailInput.checked = event.reminderEmail === 1;
      if (reminderBrowserInput) reminderBrowserInput.checked = event.reminderBrowser === 1;
      if (reminderCaldavInput) reminderCaldavInput.checked = event.reminderCaldav === 1;
      this.syncReminderPresetOptions('event-reminderPreset', !!event.allDay);
      this.setReminderPresetValue(
        'event-reminderPreset',
        event.reminderPreset || this.getDefaultReminderPreset(!!event.allDay),
        false
      );

        // 处理全天事件的日期显示
        if (event.allDay) {
          const startInfo = utils.getAllDayDisplayDate(event.startTime, false);
          const endInfo = utils.getAllDayDisplayDate(event.endTime, true);

          elements.eventForm.querySelector('[name="startDate"]').value = startInfo ? startInfo.str : '';
          elements.eventForm.querySelector('[name="endDate"]').value = endInfo ? endInfo.str : (startInfo ? startInfo.str : '');

          this.updateAllDayUI(true);
        } else {
          this.updateAllDayUI(false);
        }
        // color字段已移除

      if (event.recurrence) {
        try {
          const recurrenceObj = typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence;
          const type = recurrenceObj.type || '';

          const isLunar = type.startsWith('lunar_');
          const baseType = isLunar ? type.replace('lunar_', '') : type;

          elements.eventForm.querySelector('[name="recurrence"]').value = baseType;

          const lunarCheckbox = document.getElementById('isLunar-checkbox');
          utils.setLunarOptionVisibility(baseType === 'yearly' || baseType === 'monthly');
          if (lunarCheckbox) {
            lunarCheckbox.checked = isLunar;
          }

          if (event.recurrenceEnd) {
            elements.eventForm.querySelector('[name="recurrenceEnd"]').value = utils.formatUtcTsToDateInput(event.recurrenceEnd);
            utils.setRecurrenceEndVisibility(true);
          } else {
            elements.eventForm.querySelector('[name="recurrenceEnd"]').value = '';
            utils.setRecurrenceEndVisibility(false);
          }
        } catch (e) {
          console.error('解析recurrence失败:', e);
          elements.eventForm.querySelector('[name="recurrence"]').value = '';
          elements.eventForm.querySelector('[name="recurrenceEnd"]').value = '';
          utils.setRecurrenceEndVisibility(false);
          utils.setLunarOptionVisibility(false);
        }
      } else {
        elements.eventForm.querySelector('[name="recurrence"]').value = '';
        elements.eventForm.querySelector('[name="recurrenceEnd"]').value = '';
        utils.setRecurrenceEndVisibility(false);
        utils.setLunarOptionVisibility(false);
      }

      elements.eventForm.dataset.eventId = eventId;
      const modalTitle = elements.eventModal.querySelector('.modal-title');
      if (modalTitle) {
        if (event.isRecurringInstance) {
          modalTitle.textContent = '编辑重复事件（将修改整个系列）';
        } else {
          modalTitle.textContent = '编辑事件';
        }
      }

      this.openEventModal();
    }
  };
};
