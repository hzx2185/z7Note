(function() {
  window.createCalendarFormHandlers = function(dependencies) {
    const { state, elements, utils, api, render, sidebarRenderer, dataLoader } = dependencies;
    const getHandlers = () => dependencies.handlers;

    return {
    openTodoModal() {
      if (!elements.todoForm.dataset.todoId) {
        // 新建模式：明确初始化所有字段
        elements.todoForm.reset();

        const dateStr = utils.formatDate(state.selectedDate);
        const allDayInput = elements.todoForm.querySelector('[name="allDay"]');
        const startDateInput = elements.todoForm.querySelector('[name="startDate"]');
        const dueDateDateInput = elements.todoForm.querySelector('[name="dueDateDate"]');
        const startTimeInput = elements.todoForm.querySelector('[name="startTime"]');
        const dueDateInput = elements.todoForm.querySelector('[name="dueDate"]');

        allDayInput.value = 'true';
        startDateInput.value = dateStr;
        dueDateDateInput.value = dateStr;
        startTimeInput.value = `${dateStr}T09:00`;
        dueDateInput.value = `${dateStr}T18:00`;

        // 明确初始化checkbox状态
        const reminderEmailInput = elements.todoForm.querySelector('[name="reminderEmail"]');
        const reminderBrowserInput = elements.todoForm.querySelector('[name="reminderBrowser"]');
        if (reminderEmailInput) reminderEmailInput.checked = true;  // 默认勾选邮件提醒
        if (reminderBrowserInput) reminderBrowserInput.checked = true;  // 默认勾选浏览器提醒
        getHandlers().syncReminderPresetOptions('todo-reminderPreset', true);
        getHandlers().setReminderPresetValue('todo-reminderPreset', getHandlers().getDefaultReminderPreset(true), false);

        const modalTitle = elements.todoModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加待办事项';

        // 初始化显示状态
        getHandlers().updateTodoAllDayUI(true);
      }
      elements.todoModal.classList.add('show');
    },

    // 更新待办事项全天选项的UI显示
    updateTodoAllDayUI(isAllDay) {
      const datetimeRow = document.getElementById('todo-datetime-row');
      const dateRow = document.getElementById('todo-date-row');

      if (isAllDay) {
        datetimeRow.classList.add('hidden');
        dateRow.classList.remove('hidden');
      } else {
        datetimeRow.classList.remove('hidden');
        dateRow.classList.add('hidden');
      }
    },

    openEventModal() {
      if (!elements.eventForm.dataset.eventId) {
        // 新建模式：明确初始化所有字段
        elements.eventForm.reset();

        const startTimeInput = elements.eventForm.querySelector('[name="startTime"]');
        const endTimeInput = elements.eventForm.querySelector('[name="endTime"]');
        const allDayInput = elements.eventForm.querySelector('[name="allDay"]');
        const startDateInput = elements.eventForm.querySelector('[name="startDate"]');
        const endDateInput = elements.eventForm.querySelector('[name="endDate"]');
        const recurrenceEndInput = elements.eventForm.querySelector('[name="recurrenceEnd"]');

        const dateStr = utils.formatDate(state.selectedDate);
        startTimeInput.value = `${dateStr}T09:00`;
        endTimeInput.value = `${dateStr}T18:00`;
        allDayInput.value = 'true';
        startDateInput.value = dateStr;
        endDateInput.value = dateStr;

        // 初始化重复事件的结束日期为“事件日期 + 1 年”，避免被今天日期错误截短
        recurrenceEndInput.value = utils.getDefaultRecurrenceEndDate();

        // 明确初始化checkbox状态
        const reminderEmailInput = elements.eventForm.querySelector('[name="reminderEmail"]');
        const reminderBrowserInput = elements.eventForm.querySelector('[name="reminderBrowser"]');
        const reminderCaldavInput = elements.eventForm.querySelector('[name="reminderCaldav"]');
        if (reminderEmailInput) reminderEmailInput.checked = true;  // 默认勾选邮件提醒
        if (reminderBrowserInput) reminderBrowserInput.checked = true;  // 默认勾选浏览器提醒
        if (reminderCaldavInput) reminderCaldavInput.checked = true;  // 默认勾选日历应用提醒
        getHandlers().syncReminderPresetOptions('event-reminderPreset', true);
        getHandlers().setReminderPresetValue('event-reminderPreset', getHandlers().getDefaultReminderPreset(true), false);

        const modalTitle = elements.eventModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加事件';

        // 初始化显示状态：默认显示全天 UI
        getHandlers().updateAllDayUI(true);
      }
      elements.eventModal.classList.add('show');
    },

    // 更新全天事件的UI显示
    updateAllDayUI(isAllDay) {
      const datetimeRow = document.getElementById('datetime-row');
      const dateRow = document.getElementById('date-row');
      const startTimeInput = elements.eventForm.querySelector('[name="startTime"]');
      const startDateInput = elements.eventForm.querySelector('[name="startDate"]');

      if (isAllDay) {
        // 全天事件:显示日期选择器,隐藏时间选择器
        datetimeRow.classList.add('hidden');
        dateRow.classList.remove('hidden');
        startTimeInput.removeAttribute('required');
        startDateInput.setAttribute('required', '');
      } else {
        // 非全天事件:显示时间选择器,隐藏日期选择器
        datetimeRow.classList.remove('hidden');
        dateRow.classList.add('hidden');
        startTimeInput.setAttribute('required', '');
        startDateInput.removeAttribute('required');
      }
    },

    closeModals() {
      if (elements.todoModal) {
        elements.todoModal.classList.remove('show');
      }
      if (elements.eventModal) {
        elements.eventModal.classList.remove('show');
      }
      // 重要：不要在这里reset form，因为它会覆盖checkboxes的状态
      // 让form保持当前状态，等待下次编辑时由editTodo/editEvent明确设置
      if (elements.todoForm) {
        delete elements.todoForm.dataset.todoId;
      }
      if (elements.eventForm) {
        delete elements.eventForm.dataset.eventId;
      }
    },

    async handleTodoSubmit(e) {
      e.preventDefault();

      const formData = new FormData(elements.todoForm);
      const data = Object.fromEntries(formData.entries());

      // 显式处理复选框
      data.reminderEmail = elements.todoForm.querySelector('[name="reminderEmail"]')?.checked ? 1 : 0;
      data.reminderBrowser = elements.todoForm.querySelector('[name="reminderBrowser"]')?.checked ? 1 : 0;

      data.allDay = data.allDay === 'true';

      if (data.allDay) {
        // 全天待办: 统一使用 UTC 00:00:00 存储
        if (data.startDate) {
          const [y, m, d] = data.startDate.split('-').map(Number);
          data.startTime = Math.floor(Date.UTC(y, m - 1, d) / 1000);
        }
        if (data.dueDateDate) {
          const [y, m, d] = data.dueDateDate.split('-').map(Number);
          data.dueDate = Math.floor(Date.UTC(y, m - 1, d) / 1000);
        }
      } else {
        // 非全天待办:使用时间选择器的值
        if (data.startTime) {
          data.startTime = Math.floor(new Date(data.startTime).getTime() / 1000);
        }
        if (data.dueDate) {
          data.dueDate = Math.floor(new Date(data.dueDate).getTime() / 1000);
        }
      }

      if (data.priority) {
        data.priority = parseInt(data.priority);
      }

      try {
        const todoId = elements.todoForm.dataset.todoId;
        if (todoId) {
          await api.updateTodo(todoId, data);
        } else {
          await api.createTodo(data);
        }

        // 对齐事件保存逻辑：强制刷新缓存
        state.lunarCache.clear();

        // 更新未完成待办事项数量
        await sidebarRenderer.updateIncompleteCount();

        // 强制重新加载所有待办数据，确保侧边栏缓存中的 todo 对象是最新的
        await sidebarRenderer.loadAllTodos();

        this.closeModals();

        // 如果不是待办标签，可能需要刷新侧栏以确保其他类型数据的展示（尽管此处主要是待办）
        if (state.sidebar.currentTab !== 'todo') {
          await sidebarRenderer.refresh();
        }

        await dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('保存待办事项失败:', error);
        alert('保存失败，请重试');
      }
    },

    async handleEventSubmit(e) {
      e.preventDefault();

      const formData = new FormData(elements.eventForm);
      const data = Object.fromEntries(formData.entries());

      const eventId = elements.eventForm.dataset.eventId;

        data.allDay = data.allDay === 'true';
        data.timezone = utils.getLocalTimeZone();

        // 显式处理复选框，因为未勾选的复选框不会出现在 FormData 中
        data.reminderEmail = elements.eventForm.querySelector('[name="reminderEmail"]')?.checked ? 1 : 0;
        data.reminderBrowser = elements.eventForm.querySelector('[name="reminderBrowser"]')?.checked ? 1 : 0;
        data.reminderCaldav = elements.eventForm.querySelector('[name="reminderCaldav"]')?.checked ? 1 : 0;

        // 处理全天事件的日期
        if (data.allDay) {
          // 全天事件: 统一使用 UTC 00:00:00 存储，确保与 Mac/iOS 客户端标准一致
          if (data.startDate) {
            const [y, m, d] = data.startDate.split('-').map(Number);
            data.startTime = Math.floor(Date.UTC(y, m - 1, d) / 1000);
          }

          if (data.endDate) {
            const [y, m, d] = data.endDate.split('-').map(Number);
            // 结束时间存为下一天的 UTC 00:00:00
            data.endTime = Math.floor(Date.UTC(y, m - 1, d + 1) / 1000);
          } else {
            const [y, m, d] = data.startDate.split('-').map(Number);
            data.endTime = Math.floor(Date.UTC(y, m - 1, d + 1) / 1000);
          }
        } else {
          // 非全天事件:使用时间选择器的值
          if (data.startTime) {
            data.startTime = Math.floor(new Date(data.startTime).getTime() / 1000);
          }
          if (data.endTime) {
            data.endTime = Math.floor(new Date(data.endTime).getTime() / 1000);
          }
        }

      if (data.recurrence) {
        const isLunar = elements.eventForm.querySelector('[name="isLunar"]')?.checked;
        const recurrenceType = isLunar ? `lunar_${data.recurrence}` : data.recurrence;
        data.recurrence = JSON.stringify({ type: recurrenceType });
        if (data.recurrenceEnd) {
          data.recurrenceEnd = utils.parseDateInputToUtcTs(data.recurrenceEnd);
        }
      } else {
        data.recurrence = null;
        data.recurrenceEnd = null;
      }

      try {
        if (eventId) {
          await api.updateEvent(eventId, data);
        } else {
          await api.createEvent(data);
        }

        // 关键：保存后清空农历缓存，强制重新渲染
        state.lunarCache.clear();

        this.closeModals();
        delete elements.eventForm.dataset.eventId;
        const modalTitle = elements.eventModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加事件';

        // 强制侧边栏和主日历重新从服务器拉取数据
        await sidebarRenderer.refresh();
        await dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('保存事件失败:', error);
        alert(`保存失败：${error.message || '请重试'}`);
      }
    },

    async getRecurringDeleteSummary(originalId, occurrenceStartTime) {
      try {
        const allEvents = await api.request('/api/events');
        const masterEvent = allEvents.find(event => String(event.id) === String(originalId));
        if (!masterEvent || !masterEvent.recurrence) return null;

        const rangeStart = masterEvent.startTime;
        const rangeEnd = masterEvent.recurrenceEnd || Math.max(
          occurrenceStartTime + 366 * 24 * 60 * 60,
          (masterEvent.startTime || occurrenceStartTime) + 5 * 366 * 24 * 60 * 60
        );

        const expandedEvents = await api.request(
          `/api/events/expand-recurring?startDate=${rangeStart}&endDate=${rangeEnd}`
        );

        const occurrences = expandedEvents
          .filter(event => String(event._originalId || event.parentEventId || event.id) === String(originalId))
          .sort((a, b) => a.startTime - b.startTime);

        const previous = occurrences.filter(event => event.startTime < occurrenceStartTime).length;
        const current = occurrences.some(event => event.startTime === occurrenceStartTime) ? 1 : 1;
        const future = occurrences.filter(event => event.startTime > occurrenceStartTime).length;

        return { previous, current, future };
      } catch (error) {
        console.warn('计算重复事件删除范围统计失败:', error);
        return null;
      }
    },

    // 显示精简确认框 (支持可选复选框、单选项和自定义操作按钮)
    showConfirm(message, options = {}) {
      return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const msgEl = document.getElementById('confirm-message');
        const extraEl = document.getElementById('confirm-extra');
        const checkboxEl = document.getElementById('confirm-checkbox');
        const checkboxLabelEl = document.getElementById('confirm-checkbox-label');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');
        const actionsEl = document.getElementById('confirm-actions');
        const originalActionsMarkup = actionsEl.innerHTML;
        const originalExtraMarkup = extraEl.innerHTML;
        let selectedChoice = options.defaultChoice || '';
        const selectedCheckboxChoices = new Set(Array.isArray(options.defaultCheckedValues) ? options.defaultCheckedValues : []);
        const updateConfirmDisabledState = () => {
          if (Array.isArray(options.checkboxChoices) && options.checkboxChoices.length > 0) {
            okBtn.disabled = selectedCheckboxChoices.size === 0;
            return;
          }
          okBtn.disabled = false;
        };
        const cleanup = (result) => {
          modal.classList.remove('show');
          actionsEl.classList.remove('stacked-actions');
          actionsEl.innerHTML = originalActionsMarkup;
          extraEl.classList.add('hidden');
          extraEl.classList.remove('confirm-choice-list');
          extraEl.innerHTML = originalExtraMarkup;
          extraEl.style.display = 'none';
          resolve(result);
        };

        msgEl.textContent = message;

        if (Array.isArray(options.checkboxChoices) && options.checkboxChoices.length > 0) {
          extraEl.classList.remove('hidden');
          extraEl.style.display = 'block';
          extraEl.classList.add('confirm-choice-list');
          extraEl.innerHTML = options.checkboxChoices.map((choice) => `
            <label class="confirm-choice-item">
              <input
                type="checkbox"
                name="confirm-checkbox-choice"
                value="${choice.value}"
                ${selectedCheckboxChoices.has(choice.value) ? 'checked' : ''}
              >
              <span class="confirm-choice-text">
                <span class="confirm-choice-title">${choice.label}</span>
                ${choice.meta ? `<span class="confirm-choice-meta">${choice.meta}</span>` : ''}
              </span>
            </label>
          `).join('');
          extraEl.querySelectorAll('input[name="confirm-checkbox-choice"]').forEach(input => {
            input.addEventListener('change', () => {
              if (input.checked) {
                selectedCheckboxChoices.add(input.value);
              } else {
                selectedCheckboxChoices.delete(input.value);
              }
              updateConfirmDisabledState();
            });
          });
        } else if (Array.isArray(options.choices) && options.choices.length > 0) {
          extraEl.classList.remove('hidden');
          extraEl.style.display = 'block';
          extraEl.classList.add('confirm-choice-list');
          extraEl.innerHTML = options.choices.map((choice, index) => `
            <label class="confirm-choice-item">
              <input
                type="radio"
                name="confirm-choice"
                value="${choice.value}"
                ${choice.value === selectedChoice || (!selectedChoice && index === 0) ? 'checked' : ''}
              >
              <span class="confirm-choice-text">
                <span class="confirm-choice-title">${choice.label}</span>
                ${choice.meta ? `<span class="confirm-choice-meta">${choice.meta}</span>` : ''}
              </span>
            </label>
          `).join('');
          selectedChoice = selectedChoice || options.choices[0].value;
          extraEl.querySelectorAll('input[name="confirm-choice"]').forEach(input => {
            input.addEventListener('change', () => {
              selectedChoice = input.value;
            });
          });
        } else if (options.showCheckbox) {
          extraEl.classList.remove('hidden');
          extraEl.style.display = 'flex';
          checkboxLabelEl.textContent = options.checkboxLabel || '选项';
          checkboxEl.checked = !!options.checkboxChecked;
        } else {
          extraEl.classList.add('hidden');
          extraEl.style.display = 'none';
        }

        if (Array.isArray(options.actions) && options.actions.length > 0) {
          const useStackedActions = options.layout === 'stacked' || options.actions.length >= 3;
          actionsEl.innerHTML = '';
          actionsEl.classList.toggle('stacked-actions', useStackedActions);
          options.actions.forEach((action, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = action.className || `btn ${index === options.actions.length - 1 ? 'btn-primary' : ''}`.trim();
            button.textContent = action.label;
            button.onclick = () => cleanup(action.value);
            actionsEl.appendChild(button);
          });
          if (!options.hideCancel) {
            const cancelActionBtn = document.createElement('button');
            cancelActionBtn.type = 'button';
            cancelActionBtn.className = 'btn';
            cancelActionBtn.textContent = options.cancelLabel || '取消';
            cancelActionBtn.onclick = () => cleanup(false);
            if (useStackedActions) {
              actionsEl.appendChild(cancelActionBtn);
            } else {
              actionsEl.prepend(cancelActionBtn);
            }
          }
        }

        modal.classList.add('show');
        okBtn.textContent = options.confirmLabel || '确定';
        cancelBtn.textContent = options.cancelLabel || '取消';
        updateConfirmDisabledState();

        okBtn.onclick = () => {
          if (Array.isArray(options.checkboxChoices) && options.checkboxChoices.length > 0) {
            cleanup(Array.from(selectedCheckboxChoices));
          } else if (Array.isArray(options.choices) && options.choices.length > 0) {
            cleanup(selectedChoice || false);
          } else if (options.showCheckbox) {
            cleanup({ confirmed: true, checked: checkboxEl.checked });
          } else {
            cleanup(true);
          }
        };
        cancelBtn.onclick = () => cleanup(false);
        modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
      });
    },
    };
  };
})();
