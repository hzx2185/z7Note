/**
 * z7Note Calendar Application
 * 重构版本 - 模块化架构
 */

const CalendarApp = (function() {
  // ==================== 状态管理 ====================
  const state = {
    currentDate: new Date(),
    selectedDate: new Date(),
    currentMonthTodos: [],
    currentMonthEvents: [],
    currentMonthNotes: [],
    isLoading: false
  };

  // ==================== DOM 元素缓存 ====================
  const elements = {
    monthView: document.getElementById('month-view'),
    monthViewGrid: document.getElementById('month-view-grid'),
    currentMonth: document.getElementById('current-month'),
    sidebarDate: document.getElementById('sidebar-date'),
    todoList: document.getElementById('todo-list'),
    eventList: document.getElementById('event-list'),
    noteList: document.getElementById('note-list'),
    todoModal: document.getElementById('todo-modal'),
    eventModal: document.getElementById('event-modal'),
    todoForm: document.getElementById('todo-form'),
    eventForm: document.getElementById('event-form'),
    todoAddBtn: document.getElementById('todo-add-btn'),
    eventAddBtn: document.getElementById('event-add-btn'),
    newEventBtn: document.getElementById('new-event-btn')
  };

  // ==================== 工具函数 ====================
  const utils = {
    formatDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },

    formatDisplayDate(date) {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
      return `${year}年${month}月${day}日 星期${weekDays[date.getDay()]}`;
    },

    formatTime(timestamp) {
      const date = new Date(timestamp);
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    },

    isSameDay(date1, date2) {
      return date1.getFullYear() === date2.getFullYear() &&
             date1.getMonth() === date2.getMonth() &&
             date1.getDate() === date2.getDate();
    },

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    getPriorityLabel(priority) {
      const labels = { 1: '低', 2: '中', 3: '高' };
      return labels[priority] || '中';
    },

    getPriorityClass(priority) {
      const classes = { 1: 'low', 2: 'medium', 3: 'high' };
      return classes[priority] || 'medium';
    },

    getWeekDates(date) {
      const current = new Date(date);
      const dayOfWeek = current.getDay();
      const startOfWeek = new Date(current);
      startOfWeek.setDate(current.getDate() - dayOfWeek);

      const weekDates = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        weekDates.push(d);
      }
      return weekDates;
    }
  };

  // ==================== API 服务 ====================
  const api = {
    async request(url, options = {}) {
      try {
        const response = await fetch(url, {
          ...options,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        console.error(`API请求失败: ${url}`, error);
        throw error;
      }
    },

    async getDayData(dateStr) {
      try {
        const response = await fetch(`/api/events/calendar/day/${dateStr}`, {
          credentials: 'include'
        });
        if (!response.ok) {
          // 如果404，返回空数据而不是抛出错误
          if (response.status === 404) {
            return { todos: [], events: [], notes: [] };
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        // 返回空数据而不是抛出错误
        return { todos: [], events: [], notes: [] };
      }
    },

    async getMonthTodos(startDate, endDate) {
      try {
        const response = await fetch(`/api/todos?startDate=${startDate}&endDate=${endDate}`, {
          credentials: 'include'
        });
        return response.ok ? await response.json() : [];
      } catch (error) {
        console.error('获取月份数据失败:', error);
        return [];
      }
    },

    async getMonthEvents(startDate, endDate) {
      try {
        const response = await fetch(`/api/events?startDate=${startDate}&endDate=${endDate}`, {
          credentials: 'include'
        });
        return response.ok ? await response.json() : [];
      } catch (error) {
        console.error('获取月份数据失败:', error);
        return [];
      }
    },

    async getMonthNotes(startDate, endDate) {
      try {
        const response = await fetch(`/api/files`, {
          credentials: 'include'
        });
        const allFiles = response.ok ? await response.json() : [];

        // 将秒时间戳转换为毫秒时间戳进行比较
        const startDateMs = startDate * 1000;
        const endDateMs = endDate * 1000;

        // 过滤出在指定时间范围内的文件
        const filteredFiles = allFiles.filter(file => {
          if (file.updatedAt) {
            // file.updatedAt 已经是毫秒时间戳
            return file.updatedAt >= startDateMs && file.updatedAt <= endDateMs;
          }
          return false;
        });

        return filteredFiles || [];
      } catch (error) {
        console.error('获取月份数据失败:', error);
        return [];
      }
    },

    async createTodo(data) {
      return this.request('/api/todos', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    async createEvent(data) {
      return this.request('/api/events', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    async toggleTodo(id, completed) {
      return this.request(`/api/todos/${id}/toggle`, {
        method: 'PATCH'
      });
    },

    async deleteTodo(id) {
      return this.request(`/api/todos/${id}`, {
        method: 'DELETE'
      });
    },

    async updateTodo(id, data) {
      return this.request(`/api/todos/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    async deleteEvent(id) {
      return this.request(`/api/events/${id}`, {
        method: 'DELETE'
      });
    },

    async updateEvent(id, data) {
      return this.request(`/api/events/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    async getLunarDate(dateStr) {
      try {
        const response = await fetch(`/api/lunar/${dateStr}`, {
          credentials: 'include'
        });
        return response.ok ? await response.json() : null;
      } catch (error) {
        console.error('获取农历日期失败:', error);
        return null;
      }
    }
  };

  // ==================== 渲染函数 ====================
  const render = {
    calendar() {
      // 始终显示月视图
      elements.monthView.style.display = 'flex';
      this.renderMonthView();
    },

    renderMonthView() {
      const year = state.currentDate.getFullYear();
      const month = state.currentDate.getMonth();

      // 更新标题
      elements.currentMonth.textContent = `${year}年${month + 1}月`;

      // 清除之前的日期单元格
      if (elements.monthViewGrid) {
        elements.monthViewGrid.innerHTML = '';
      }

      // 检测是否为窄屏
      const isNarrow = window.innerWidth <= 768;

      if (isNarrow) {
        // 窄屏下只渲染选中日期所在的那一行
        this.renderNarrowWeekView();
      } else {
        // 正常渲染完整的月视图
        this.renderFullMonthView(year, month);
      }

      // 加载月份数据
      dataLoader.loadMonthData(year, month);
    },

    renderFullMonthView(year, month) {
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startDayOfWeek = firstDay.getDay();
      const totalDays = lastDay.getDate();
      const prevLastDay = new Date(year, month, 0).getDate();

      // 上个月的日期
      for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevLastDay - i;
        const dateStr = utils.formatDate(new Date(year, month - 1, day));
        this.createMonthDayCell(day, dateStr, true);
      }

      // 当前月的日期
      for (let i = 1; i <= totalDays; i++) {
        const date = new Date(year, month, i);
        const dateStr = utils.formatDate(date);
        const isToday = utils.isSameDay(date, new Date());
        const isSelected = utils.isSameDay(date, state.selectedDate);
        this.createMonthDayCell(i, dateStr, false, isToday, isSelected);
      }

      // 下个月的日期
      const remainingCells = 42 - (startDayOfWeek + totalDays);
      for (let i = 1; i <= remainingCells; i++) {
        const dateStr = utils.formatDate(new Date(year, month + 1, i));
        this.createMonthDayCell(i, dateStr, true);
      }

      // 加载农历日期
      this.loadLunarDates(year, month);
    },

    async loadLunarDates(year, month) {
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const totalDays = lastDay.getDate();

      for (let i = 1; i <= totalDays; i++) {
        const dateStr = utils.formatDate(new Date(year, month, i));
        const lunarEl = document.getElementById(`day-lunar-${dateStr}`);

        if (lunarEl) {
          try {
            const lunarData = await api.getLunarDate(dateStr);
            if (lunarData && lunarData.lunarDayCn) {
              lunarEl.textContent = lunarData.lunarDayCn;
              // 如果是节日,显示节日名称
              if (lunarData.festival) {
                lunarEl.textContent = lunarData.festival;
                lunarEl.classList.add('day-festival');
              }
            }
          } catch (error) {
            console.error('加载农历日期失败:', error);
          }
        }
      }
    },

    renderNarrowWeekView() {
      // 获取选中日期所在周的日期
      const selectedDayOfWeek = state.selectedDate.getDay();
      const weekStart = new Date(state.selectedDate);
      weekStart.setDate(state.selectedDate.getDate() - selectedDayOfWeek);

      // 渲染一周的日期
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        const dateStr = utils.formatDate(date);
        const isToday = utils.isSameDay(date, new Date());
        const isSelected = utils.isSameDay(date, state.selectedDate);
        const isOtherMonth = date.getMonth() !== state.currentDate.getMonth();

        this.createMonthDayCell(date.getDate(), dateStr, isOtherMonth, isToday, isSelected);
      }
    },

    createMonthDayCell(day, dateStr, isOtherMonth, isToday = false, isSelected = false) {
      const cell = document.createElement('div');
      cell.className = 'month-day';
      if (isOtherMonth) cell.classList.add('other-month');
      if (isToday) cell.classList.add('today');
      if (isSelected) cell.classList.add('selected');

      cell.innerHTML = `
        <div class="day-header">
          <span class="month-day-number">${day}</span>
          <span class="day-lunar" id="day-lunar-${dateStr}"></span>
        </div>
        <div class="day-summary" id="day-summary-${dateStr}"></div>
        <div class="day-content" id="day-content-${dateStr}"></div>
      `;

      cell.addEventListener('click', () => {
        state.selectedDate = new Date(dateStr);
        render.calendar();
        dataLoader.loadDayData();
      });

      if (elements.monthViewGrid) {
        elements.monthViewGrid.appendChild(cell);
      }
    },

    updateMonthIndicators() {
      // 清除旧的内容
      elements.monthView.querySelectorAll('.day-content').forEach(container => {
        container.innerHTML = '';
      });

      // 清除旧的摘要
      elements.monthView.querySelectorAll('.day-summary').forEach(container => {
        container.innerHTML = '';
      });

      // 检测是否为窄屏
      const isNarrow = window.innerWidth <= 768;

      // 获取选中日期所在的行
      const selectedDateStr = utils.formatDate(state.selectedDate);
      const selectedDate = new Date(selectedDateStr);
      const selectedDayOfWeek = selectedDate.getDay();

      // 构建日期数据映射
      const dateMap = new Map();

      // 映射待办事项
      state.currentMonthTodos.forEach(todo => {
        if (todo.dueDate) {
          const dateKey = utils.formatDate(new Date(todo.dueDate * 1000));
          const existing = dateMap.get(dateKey) || { todos: [], events: [], notes: [] };
          existing.todos.push(todo);
          dateMap.set(dateKey, existing);
        }
      });

      // 映射事件
      state.currentMonthEvents.forEach(event => {
        const startDate = new Date(event.startTime * 1000);
        const endDate = event.endTime ? new Date(event.endTime * 1000) : startDate;

        const current = new Date(startDate);
        while (current <= endDate) {
          const dateKey = utils.formatDate(current);
          const existing = dateMap.get(dateKey) || { todos: [], events: [], notes: [] };
          existing.events.push(event);
          dateMap.set(dateKey, existing);
          current.setDate(current.getDate() + 1);
        }
      });

      // 映射笔记
      state.currentMonthNotes.forEach(note => {
        // 尝试多个时间戳字段
        let timestamp = null;
        if (note.updatedAt) {
          timestamp = note.updatedAt;
        } else if (note.createdAt) {
          timestamp = note.createdAt;
        } else if (note.date) {
          timestamp = note.date;
        }

        if (timestamp) {
          // 注意: updatedAt 已经是毫秒时间戳,不需要再乘以 1000
          const dateKey = utils.formatDate(new Date(timestamp));
          const existing = dateMap.get(dateKey) || { todos: [], events: [], notes: [] };
          existing.notes.push(note);
          dateMap.set(dateKey, existing);
        }
      });

      // 更新DOM
      dateMap.forEach((data, dateStr) => {
        const container = document.getElementById(`day-content-${dateStr}`);
        const summaryContainer = document.getElementById(`day-summary-${dateStr}`);

        // 更新摘要(总是显示,无论窄屏还是宽屏)
        if (summaryContainer) {
          const todoCount = data.todos.length;
          const eventCount = data.events.length;
          const noteCount = data.notes.length;
          const total = todoCount + eventCount + noteCount;

          if (total > 0) {
            summaryContainer.innerHTML = '';
            if (todoCount > 0) {
              const todoBadge = document.createElement('span');
              todoBadge.className = 'day-badge day-badge-todo';
              todoBadge.textContent = `待${todoCount}`;
              summaryContainer.appendChild(todoBadge);
            }
            if (eventCount > 0) {
              const eventBadge = document.createElement('span');
              eventBadge.className = 'day-badge day-badge-event';
              eventBadge.textContent = `事${eventCount}`;
              summaryContainer.appendChild(eventBadge);
            }
            if (noteCount > 0) {
              const noteBadge = document.createElement('span');
              noteBadge.className = 'day-badge day-badge-note';
              noteBadge.textContent = `笔${noteCount}`;
              summaryContainer.appendChild(noteBadge);
            }
          }
        }

        if (container) {
          // 窄屏下显示所有内容(因为只渲染了一周),宽屏下只显示选中日期所在行的内容
          let shouldDisplay = false;

          if (isNarrow) {
            // 窄屏下显示所有内容
            shouldDisplay = true;
          } else {
            // 宽屏下只显示选中日期所在行的内容
            const currentDate = new Date(dateStr);
            const currentDayOfWeek = currentDate.getDay();

            const selectedWeekStart = new Date(selectedDate);
            selectedWeekStart.setDate(selectedDate.getDate() - selectedDayOfWeek);

            const currentWeekStart = new Date(currentDate);
            currentWeekStart.setDate(currentDate.getDate() - currentDayOfWeek);

            shouldDisplay = selectedWeekStart.getTime() === currentWeekStart.getTime();
          }

          if (shouldDisplay) {
            const items = [];

            // 收集要显示的项目（最多5个）
            data.events.slice(0, 5).forEach(event => {
              items.push({ type: 'event', data: event });
            });

            // 如果事件不足5个，补充待办事项
            if (items.length < 5) {
              data.todos.slice(0, 5 - items.length).forEach(todo => {
                items.push({ type: 'todo', data: todo });
              });
            }

            // 渲染项目
            items.forEach(item => {
              const div = document.createElement('div');
              div.className = `day-preview-item ${item.type}`;
              div.textContent = item.data.title;
              div.title = item.data.title;
              container.appendChild(div);
            });

            // 显示剩余数量
            const totalItems = data.events.length + data.todos.length;
            if (totalItems > 5) {
              const more = document.createElement('div');
              more.className = 'day-more';
              more.textContent = `+${totalItems - 5}`;
              container.appendChild(more);
            }
          }
        }
      });
    },

    todos(todos) {
      elements.todoList.innerHTML = '';

      if (!todos || todos.length === 0) {
        elements.todoList.innerHTML = '<div class="empty-state">暂无待办事项</div>';
        return;
      }

      todos.forEach(todo => {
        const item = document.createElement('div');
        item.className = 'todo-item';

        // 构建元数据信息
        let metaHtml = '';
        if (todo.priority) {
          metaHtml += `<span class="todo-priority ${utils.getPriorityClass(todo.priority)}">${utils.getPriorityLabel(todo.priority)}</span>`;
        }
        if (todo.dueDate) {
          metaHtml += `<span class="todo-date">${utils.formatTime(todo.dueDate * 1000)}</span>`;
        }

        item.innerHTML = `
          <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''}>
          <div class="todo-content" data-id="${todo.id}">
            <div class="todo-title ${todo.completed ? 'completed' : ''}">${utils.escapeHtml(todo.title)}</div>
            ${metaHtml ? `<div class="todo-meta">${metaHtml}</div>` : ''}
          </div>
          <div class="todo-actions">
            <button class="edit-btn" data-id="${todo.id}" title="编辑">✎</button>
            <button class="delete-btn" data-id="${todo.id}" title="删除">×</button>
          </div>
        `;

        // 事件监听
        const checkbox = item.querySelector('.todo-checkbox');
        checkbox.addEventListener('change', () => handlers.toggleTodo(todo.id, checkbox.checked));

        const contentDiv = item.querySelector('.todo-content');
        contentDiv.addEventListener('click', () => handlers.editTodo(todo));

        const editBtn = item.querySelector('.edit-btn');
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handlers.editTodo(todo);
        });

        const deleteBtn = item.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handlers.deleteTodo(todo.id);
        });

        elements.todoList.appendChild(item);
      });
    },

    events(events) {
      elements.eventList.innerHTML = '';

      if (!events || events.length === 0) {
        elements.eventList.innerHTML = '<div class="empty-state">暂无事件</div>';
        return;
      }

      events.forEach(event => {
        const item = document.createElement('div');
        item.className = 'event-item';
        item.style.borderLeftColor = event.color || '#2563eb';

        // 构建时间信息
        let timeHtml = '';
        if (event.allDay) {
          timeHtml = '<span class="event-all-day">全天</span>';
        } else {
          timeHtml = utils.formatTime(event.startTime * 1000);
          if (event.endTime) {
            timeHtml += ` - ${utils.formatTime(event.endTime * 1000)}`;
          }
        }

        item.innerHTML = `
          <div class="event-content" data-id="${event.id}">
            <div class="event-title">${utils.escapeHtml(event.title)}</div>
            <div class="event-time">${timeHtml}</div>
          </div>
          <div class="event-actions">
            <button class="edit-btn" data-id="${event.id}" title="编辑">✎</button>
            <button class="delete-btn" data-id="${event.id}" title="删除">×</button>
          </div>
        `;

        // 点击事件主体打开编辑
        const eventContent = item.querySelector('.event-content');
        eventContent.addEventListener('click', () => {
          handlers.editEvent(event);
        });

        const editBtn = item.querySelector('.edit-btn');
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handlers.editEvent(event);
        });

        const deleteBtn = item.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handlers.deleteEvent(event.id);
        });

        elements.eventList.appendChild(item);
      });
    },

    notes(notes) {
      elements.noteList.innerHTML = '';

      if (!notes || notes.length === 0) {
        elements.noteList.innerHTML = '<div class="empty-state">当日无笔记</div>';
        return;
      }

      notes.forEach(note => {
        const item = document.createElement('div');
        item.className = 'note-item';
        item.title = note.title;
        item.innerHTML = `<div class="note-title">${utils.escapeHtml(note.title)}</div>`;

        item.addEventListener('click', () => {
          window.open(`/?id=${note.id}`, '_blank');
        });

        elements.noteList.appendChild(item);
      });
    }
  };

  // ==================== 数据加载 ====================
  const dataLoader = {
    async loadMonthData(year, month) {
      try {
        const startDate = Math.floor(new Date(year, month, 1).getTime() / 1000);
        const endDate = Math.floor(new Date(year, month + 1, 0, 23, 59, 59).getTime() / 1000);

        const [todos, events, notes] = await Promise.all([
          api.getMonthTodos(startDate, endDate),
          api.getMonthEvents(startDate, endDate),
          api.getMonthNotes(startDate, endDate)
        ]);

        state.currentMonthTodos = todos || [];
        state.currentMonthEvents = events || [];
        state.currentMonthNotes = notes || [];

        render.updateMonthIndicators();
      } catch (error) {
        console.error('加载月份数据失败:', error);
        state.currentMonthTodos = [];
        state.currentMonthEvents = [];
        state.currentMonthNotes = [];
      }
    },

    async loadDayData() {
      const dateStr = utils.formatDate(state.selectedDate);
      elements.sidebarDate.textContent = utils.formatDisplayDate(state.selectedDate);

      try {
        const data = await api.getDayData(dateStr);

        render.todos(data.todos || []);
        render.events(data.events || []);
        render.notes(data.notes || []);
      } catch (error) {
        console.error('加载日期数据失败:', error);
        render.todos([]);
        render.events([]);
        render.notes([]);
      }
    }
  };

  // ==================== 事件处理 ====================
  const handlers = {
    prevMonth() {
      state.currentDate.setMonth(state.currentDate.getMonth() - 1);
      render.calendar();
      // 重新加载侧边栏数据
      dataLoader.loadDayData();
    },

    nextMonth() {
      state.currentDate.setMonth(state.currentDate.getMonth() + 1);
      render.calendar();
      // 重新加载侧边栏数据
      dataLoader.loadDayData();
    },

    today() {
      state.currentDate = new Date();
      state.selectedDate = new Date();
      render.calendar();
      dataLoader.loadDayData();
    },

    openTodoModal() {
      console.log('[CalendarApp] openTodoModal called');

      // 如果不是编辑模式,清空表单并设置默认值
      if (!elements.todoForm.dataset.todoId) {
        const dueDateInput = elements.todoForm.querySelector('[name="dueDate"]');
        dueDateInput.value = utils.formatDate(state.selectedDate);
        const modalTitle = elements.todoModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加待办事项';
      }

      console.log('[CalendarApp] todoModal before:', elements.todoModal.classList.toString());
      elements.todoModal.classList.add('show');
      console.log('[CalendarApp] todoModal after:', elements.todoModal.classList.toString());
    },

    openEventModal() {
      console.log('[CalendarApp] openEventModal called');

      // 如果不是编辑模式,设置默认值
      if (!elements.eventForm.dataset.eventId) {
        const startTimeInput = elements.eventForm.querySelector('[name="startTime"]');
        const endTimeInput = elements.eventForm.querySelector('[name="endTime"]');
        const allDayInput = elements.eventForm.querySelector('[name="allDay"]');

        console.log('[CalendarApp] inputs:', { startTimeInput, endTimeInput, allDayInput });

        const dateStr = utils.formatDate(state.selectedDate);
        startTimeInput.value = `${dateStr}T09:00`;
        endTimeInput.value = `${dateStr}T18:00`;
        allDayInput.value = 'false';
        const modalTitle = elements.eventModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加事件';
      }

      elements.eventModal.classList.add('show');

      // 检查模态框内部的 .modal 元素
      const modalContent = elements.eventModal.querySelector('.modal');
      console.log('[CalendarApp] modalContent:', modalContent);
      console.log('[CalendarApp] modalContent computed display:', window.getComputedStyle(modalContent).display);
      console.log('[CalendarApp] modalContent computed visibility:', window.getComputedStyle(modalContent).visibility);
      console.log('[CalendarApp] modalContent computed opacity:', window.getComputedStyle(modalContent).opacity);
      console.log('[CalendarApp] eventModal computed display:', window.getComputedStyle(elements.eventModal).display);
    },

    closeModals() {
      if (elements.todoModal) {
        elements.todoModal.classList.remove('show');
      }
      if (elements.eventModal) {
        elements.eventModal.classList.remove('show');
      }
      if (elements.todoForm) {
        elements.todoForm.reset();
        delete elements.todoForm.dataset.todoId;
      }
      if (elements.eventForm) {
        elements.eventForm.reset();
        delete elements.eventForm.dataset.eventId;
      }
    },

    async handleTodoSubmit(e) {
      e.preventDefault();

      const formData = new FormData(elements.todoForm);
      const data = Object.fromEntries(formData.entries());

      // 转换日期格式为 Unix 时间戳（秒）
      if (data.dueDate) {
        data.dueDate = Math.floor(new Date(data.dueDate).getTime() / 1000);
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
        this.closeModals();
        dataLoader.loadDayData();
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('保存待办事项失败:', error);
        alert('保存失败，请重试');
      }
    },

    async handleEventSubmit(e) {
      e.preventDefault();

      const formData = new FormData(elements.eventForm);
      const data = Object.fromEntries(formData.entries());

      // 检查是否是编辑模式
      const eventId = elements.eventForm.dataset.eventId;

      // 转换时间格式
      if (data.startTime) {
        data.startTime = Math.floor(new Date(data.startTime).getTime() / 1000);
      }
      if (data.endTime) {
        data.endTime = Math.floor(new Date(data.endTime).getTime() / 1000);
      }
      data.allDay = data.allDay === 'true';

      // 处理重复事件
      if (data.recurrence) {
        data.recurrence = JSON.stringify({ type: data.recurrence });
        if (data.recurrenceEnd) {
          data.recurrenceEnd = Math.floor(new Date(data.recurrenceEnd).getTime() / 1000);
        }
      } else {
        data.recurrence = null;
        data.recurrenceEnd = null;
      }

      try {
        if (eventId) {
          // 编辑模式
          await api.updateEvent(eventId, data);
        } else {
          // 创建模式
          await api.createEvent(data);
        }
        this.closeModals();
        // 清除编辑模式标记
        delete elements.eventForm.dataset.eventId;
        document.getElementById('modal-title-event').textContent = '新建事件';

        dataLoader.loadDayData();
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('保存事件失败:', error);
        alert('保存失败，请重试');
      }
    },

    async toggleTodo(id, completed) {
      try {
        await api.toggleTodo(id, completed);
        dataLoader.loadDayData();
      } catch (error) {
        console.error('切换待办状态失败:', error);
      }
    },

    async deleteTodo(id) {
      if (!confirm('确定要删除这个待办事项吗？')) return;

      try {
        await api.deleteTodo(id);
        dataLoader.loadDayData();
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('删除待办事项失败:', error);
      }
    },

    editTodo(todo) {
      // 填充表单
      elements.todoForm.querySelector('[name="title"]').value = todo.title || '';
      elements.todoForm.querySelector('[name="description"]').value = todo.description || '';
      elements.todoForm.querySelector('[name="priority"]').value = todo.priority || 2;
      elements.todoForm.querySelector('[name="dueDate"]').value = todo.dueDate ? utils.formatDate(new Date(todo.dueDate * 1000)) : '';

      // 设置编辑模式标记
      elements.todoForm.dataset.todoId = todo.id;
      const modalTitle = elements.todoModal.querySelector('.modal-title');
      if (modalTitle) modalTitle.textContent = '编辑待办事项';

      // 显示模态框
      this.openTodoModal();
    },

    async deleteEvent(id) {
      if (!confirm('确定要删除这个事件吗？')) return;

      try {
        await api.deleteEvent(id);
        dataLoader.loadDayData();
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('删除事件失败:', error);
        alert('删除失败，请重试');
      }
    },

    editEvent(event) {
      // 填充表单
      elements.eventForm.querySelector('[name="title"]').value = event.title || '';
      elements.eventForm.querySelector('[name="description"]').value = event.description || '';
      elements.eventForm.querySelector('[name="startTime"]').value = new Date(event.startTime * 1000).toISOString().slice(0, 16);
      elements.eventForm.querySelector('[name="endTime"]').value = event.endTime ? new Date(event.endTime * 1000).toISOString().slice(0, 16) : '';
      elements.eventForm.querySelector('[name="allDay"]').checked = event.allDay === 1;
      elements.eventForm.querySelector('[name="color"]').value = event.color || '#2563eb';

      // 设置编辑模式标记
      elements.eventForm.dataset.eventId = event.id;
      const modalTitle = elements.eventModal.querySelector('.modal-title');
      if (modalTitle) modalTitle.textContent = '编辑事件';

      // 显示模态框
      this.openEventModal();
    },

    async exportCalendar() {
      try {
        const response = await fetch('/api/events/export', {
          credentials: 'include'
        });

        if (!response.ok) {
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
      } catch (error) {
        console.error('导出日历失败:', error);
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
          alert(`导入成功!共导入 ${result.imported} 个事件${result.skipped > 0 ? `,跳过 ${result.skipped} 个已存在的事件` : ''}`);

          // 重新加载日历数据
          render.calendar();
          dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
        }
      } catch (error) {
        console.error('导入日历失败:', error);
        alert('导入失败,请检查文件格式');
      } finally {
        // 清空文件输入
        e.target.value = '';
      }
    }
  };

  // ==================== 工具函数 ====================
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // ==================== 初始化 ====================
  async function checkAuth() {
    try {
      // 尝试获取当前日期的数据来验证登录状态
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const response = await fetch(`/api/events/calendar/day/${dateStr}`, {
        credentials: 'include'
      });
      // 401表示未登录，404可能没有数据但已登录
      if (response.status === 401) {
        return false;
      }
      return true;
    } catch (error) {
      // 网络错误或其他问题，默认为未登录
      console.error('[CalendarApp] 检查登录状态失败:', error);
      return false;
    }
  }

  async function init() {
    console.log('[CalendarApp] 初始化开始...');

    // 检查登录状态
    const isLoggedIn = await checkAuth();
    const loginRequiredEl = document.getElementById('login-required');

    if (!isLoggedIn) {
      // 未登录，显示登录提示
      if (loginRequiredEl) {
        loginRequiredEl.classList.add('show');
      }
      console.log('[CalendarApp] 未登录，停止初始化');
      return;
    }

    // 已登录，隐藏登录提示
    if (loginRequiredEl) {
      loginRequiredEl.classList.remove('show');
    }

    // 绑定导航按钮
    const prevMonthBtn = document.getElementById('prev-month');
    const nextMonthBtn = document.getElementById('next-month');
    const todayBtn = document.getElementById('today-btn');
    const todoAddBtn = document.getElementById('todo-add-btn');
    const eventAddBtn = document.getElementById('event-add-btn');
    const newEventBtn = document.getElementById('new-event-btn');
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const icsFileInput = document.getElementById('ics-file-input');

    if (prevMonthBtn) prevMonthBtn.addEventListener('click', handlers.prevMonth);
    if (nextMonthBtn) nextMonthBtn.addEventListener('click', handlers.nextMonth);
    if (todayBtn) todayBtn.addEventListener('click', handlers.today);
    if (todoAddBtn) todoAddBtn.addEventListener('click', handlers.openTodoModal);
    if (eventAddBtn) eventAddBtn.addEventListener('click', handlers.openEventModal);
    if (newEventBtn) newEventBtn.addEventListener('click', handlers.openEventModal);
    if (exportBtn) exportBtn.addEventListener('click', handlers.exportCalendar);
    if (importBtn) importBtn.addEventListener('click', () => icsFileInput.click());
    if (icsFileInput) icsFileInput.addEventListener('change', handlers.importCalendar);

    // 监听重复选项变化
    const recurrenceSelect = document.getElementById('recurrence-select');
    const recurrenceEndGroup = document.getElementById('recurrence-end-group');
    if (recurrenceSelect && recurrenceEndGroup) {
      recurrenceSelect.addEventListener('change', (e) => {
        recurrenceEndGroup.style.display = e.target.value ? 'block' : 'none';
      });
    }

    console.log('[CalendarApp] 导航按钮已绑定');

    // 监听窗口大小变化,重新渲染日历
    window.addEventListener('resize', debounce(() => {
      render.calendar();
      render.updateMonthIndicators();
    }, 200));

    // 绑定表单提交
    if (elements.todoForm) {
      elements.todoForm.addEventListener('submit', (e) => handlers.handleTodoSubmit(e));
    }
    if (elements.eventForm) {
      elements.eventForm.addEventListener('submit', (e) => handlers.handleEventSubmit(e));
    }

    // 模态框关闭事件 - 点击遮罩层关闭
    if (elements.todoModal) {
      elements.todoModal.addEventListener('click', (e) => {
        if (e.target === elements.todoModal) handlers.closeModals();
      });
    }
    if (elements.eventModal) {
      elements.eventModal.addEventListener('click', (e) => {
        if (e.target === elements.eventModal) handlers.closeModals();
      });
    }

    // 模态框关闭按钮事件
    document.querySelectorAll('.todo-modal-close, .event-modal-close').forEach(btn => {
      btn.addEventListener('click', handlers.closeModals);
    });

    document.querySelectorAll('.todo-modal-cancel, .event-modal-cancel').forEach(btn => {
      btn.addEventListener('click', handlers.closeModals);
    });

    // ESC键关闭模态框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') handlers.closeModals();
    });

    // 初始渲染
    render.calendar();
    dataLoader.loadDayData();

    console.log('[CalendarApp] 初始化完成');
  }

  // ==================== 公开API ====================
  return {
    init,
    openTodoModal: () => handlers.openTodoModal(),
    openEventModal: () => handlers.openEventModal(),
    closeModals: () => handlers.closeModals()
  };
})();

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', CalendarApp.init);
