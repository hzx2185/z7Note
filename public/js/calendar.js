/**
 * z7Note Calendar Application
 * 重构版本 - 支持搜索、标签过滤、滚动加载
 */

const CalendarApp = (function() {
  // ==================== 状态管理 ====================
  const state = {
    currentDate: new Date(),
    selectedDate: new Date(),
    currentMonthTodos: [],
    currentMonthEvents: [],
    currentMonthNotes: [],
    isLoading: false,
    lunarCache: new Map(),
    
    // 新增：侧边栏状态
    sidebar: {
      currentTab: 'all', // all, event, todo, note
      searchQuery: '',
      // 滚动加载相关
      loadedDays: 0, // 已加载的天数（前后各多少天）
      isLoadingMore: false,
      hasMoreBefore: true,
      hasMoreAfter: true,
      // 数据缓存 - 按日期分组
      dataByDate: new Map(), // key: 'YYYY-MM-DD', value: { todos: [], events: [], notes: [] }
      // 渲染顺序
      renderedDates: [] // 已渲染的日期列表
    }
  };

  // ==================== DOM 元素缓存 ====================
  const elements = {
    monthView: document.getElementById('month-view'),
    monthViewGrid: document.getElementById('month-view-grid'),
    currentMonth: document.getElementById('current-month'),
    sidebarDate: document.getElementById('sidebar-date'),
    sidebarContent: document.getElementById('sidebar-content'),
    sidebarSearch: document.getElementById('sidebar-search'),
    sidebarTabs: document.querySelectorAll('.sidebar-tab'),
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

    formatUTCDate(date) {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },

    formatDisplayDate(date) {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
      return `${year}年${month}月${day}日 星期${weekDays[date.getDay()]}`;
    },

    formatShortDate(date) {
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
      return `${month}月${day}日 周${weekDays[date.getDay()]}`;
    },

    formatSidebarDate(date) {
      const month = date.getMonth() + 1;
      const day = date.getDate();
      return `${month}月${day}日`;
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

    // 获取日期范围内的所有日期
    getDateRange(startDate, days) {
      const dates = [];
      for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        dates.push(date);
      }
      return dates;
    },

    // 防抖函数
    debounce(func, wait) {
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
          if (response.status === 404) {
            return { todos: [], events: [], notes: [] };
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        return { todos: [], events: [], notes: [] };
      }
    },

    // 获取多天数据
    async getRangeData(startDate, endDate) {
      try {
        const startTs = Math.floor(startDate.getTime() / 1000);
        const endTs = Math.floor(endDate.getTime() / 1000);

        const [todos, events, notes] = await Promise.all([
          this.getMonthTodos(startTs, endTs),
          this.getMonthEvents(startTs, endTs),
          this.getMonthNotes(startTs, endTs)
        ]);

        return { todos, events, notes };
      } catch (error) {
        console.error('获取范围数据失败:', error);
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

        const startDateMs = startDate * 1000;
        const endDateMs = endDate * 1000;

        const filteredFiles = allFiles.filter(file => {
          if (file.updatedAt) {
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

  // ==================== 侧边栏渲染 ====================
  const sidebarRenderer = {
    // 初始化侧边栏
    init() {
      // 绑定标签切换事件
      elements.sidebarTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          this.switchTab(tab.dataset.tab);
        });
      });

      // 绑定搜索事件
      if (elements.sidebarSearch) {
        elements.sidebarSearch.addEventListener('input', utils.debounce((e) => {
          state.sidebar.searchQuery = e.target.value.toLowerCase();
          this.render();
        }, 300));
      }

      // 绑定滚动加载事件
      if (elements.sidebarContent) {
        elements.sidebarContent.addEventListener('scroll', utils.debounce(() => {
          this.handleScroll();
        }, 100));
      }

      // 初始加载
      this.loadInitialData();
    },

    // 切换标签
    switchTab(tab) {
      state.sidebar.currentTab = tab;
      elements.sidebarTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
      });
      this.render();
    },

    // 加载初始数据（只加载选中日期当天）
    async loadInitialData() {
      const selectedDate = state.selectedDate;
      const dateStr = utils.formatDate(selectedDate);
      
      state.sidebar.loadedDays = 0;
      state.sidebar.hasMoreBefore = true;
      state.sidebar.hasMoreAfter = true;

      await this.loadDayData(dateStr);
      this.render();
    },

    // 加载单天数据
    async loadDayData(dateStr) {
      try {
        console.log('[sidebar] 加载单天数据:', dateStr);
        const data = await api.getDayData(dateStr);
        console.log('[sidebar] 收到单天数据:', {
          todos: data.todos.length,
          events: data.events.length,
          notes: data.notes.length
        });

        if (!state.sidebar.dataByDate.has(dateStr)) {
          state.sidebar.dataByDate.set(dateStr, { todos: [], events: [], notes: [] });
        }

        const dayData = state.sidebar.dataByDate.get(dateStr);
        dayData.todos = data.todos;
        dayData.events = data.events;
        dayData.notes = data.notes;

        console.log('[sidebar] 数据已设置:', dayData);
      } catch (error) {
        console.error('加载单天数据失败:', error);
      }
    },

    // 加载日期范围数据 - 兼容旧代码
    async loadDateRange(startDate, endDate) {
      try {
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
          const dateStr = utils.formatDate(currentDate);
          await this.loadDayData(dateStr);
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } catch (error) {
        console.error('加载日期范围数据失败:', error);
      }
    },

    // 处理滚动加载
    async handleScroll() {
      if (state.sidebar.isLoadingMore) return;

      const container = elements.sidebarContent;
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      // 检测是否滚动到顶部附近 - 加载更早的数据
      if (scrollTop < 100 && state.sidebar.hasMoreBefore) {
        await this.loadMoreData('before');
      }
      // 检测是否滚动到底部附近 - 加载更晚的数据
      else if (scrollHeight - scrollTop - clientHeight < 100 && state.sidebar.hasMoreAfter) {
        await this.loadMoreData('after');
      }
    },

    // 加载更多数据
    async loadMoreData(direction) {
      if (state.sidebar.isLoadingMore) return;
      
      state.sidebar.isLoadingMore = true;
      this.showLoadingIndicator(direction);

      try {
        const selectedDate = state.selectedDate;

        let targetDate;
        if (direction === 'before') {
          // 找到当前最早日期的前一天
          const dates = Array.from(state.sidebar.dataByDate.keys()).sort();
          if (dates.length > 0) {
            const earliestDate = new Date(dates[0]);
            targetDate = new Date(earliestDate);
            targetDate.setDate(earliestDate.getDate() - 1);
          } else {
            targetDate = new Date(selectedDate);
            targetDate.setDate(selectedDate.getDate() - 1);
          }
          state.sidebar.loadedDays++;
        } else {
          // 找到当前最晚日期的后一天
          const dates = Array.from(state.sidebar.dataByDate.keys()).sort();
          if (dates.length > 0) {
            const latestDate = new Date(dates[dates.length - 1]);
            targetDate = new Date(latestDate);
            targetDate.setDate(latestDate.getDate() + 1);
          } else {
            targetDate = new Date(selectedDate);
            targetDate.setDate(selectedDate.getDate() + 1);
          }
          state.sidebar.loadedDays++;
        }

        const dateStr = utils.formatDate(targetDate);
        await this.loadDayData(dateStr);
        
        // 检查是否还有更多数据（限制最多加载前后各90天）
        if (state.sidebar.loadedDays >= 90) {
          if (direction === 'before') {
            state.sidebar.hasMoreBefore = false;
          } else {
            state.sidebar.hasMoreAfter = false;
          }
        }

        this.render();
      } catch (error) {
        console.error('加载更多数据失败:', error);
      } finally {
        state.sidebar.isLoadingMore = false;
        this.hideLoadingIndicator(direction);
      }
    },

    // 显示加载指示器
    showLoadingIndicator(direction) {
      const indicator = document.createElement('div');
      indicator.className = 'load-more-indicator loading';
      indicator.id = `loading-${direction}`;
      indicator.textContent = direction === 'before' ? '↑ 加载中...' : '↓ 加载中...';
      
      const container = elements.sidebarContent;
      if (direction === 'before') {
        container.insertBefore(indicator, container.firstChild);
      } else {
        container.appendChild(indicator);
      }
    },

    // 隐藏加载指示器
    hideLoadingIndicator(direction) {
      const indicator = document.getElementById(`loading-${direction}`);
      if (indicator) {
        indicator.remove();
      }
    },

    // 渲染侧边栏内容
    render() {
      const container = elements.sidebarContent;
      if (!container) return;

      container.innerHTML = '';

      // 获取所有日期并排序
      const dates = Array.from(state.sidebar.dataByDate.keys()).sort();
      
      // 确定渲染范围
      const selectedDateStr = utils.formatDate(state.selectedDate);
      const selectedIndex = dates.indexOf(selectedDateStr);
      
      let renderDates = dates;
      if (selectedIndex >= 0) {
        // 渲染选中日期前后各loadedDays天
        const startIndex = Math.max(0, selectedIndex - state.sidebar.loadedDays);
        const endIndex = Math.min(dates.length, selectedIndex + state.sidebar.loadedDays + 1);
        renderDates = dates.slice(startIndex, endIndex);
      }

      // 按日期分组渲染
      renderDates.forEach(dateStr => {
        const dayData = state.sidebar.dataByDate.get(dateStr);
        if (!dayData) return;

        // 过滤数据
        const filteredData = this.filterData(dayData);
        
        // 根据当前标签检查是否有数据需要显示
        let hasData = false;
        if (state.sidebar.currentTab === 'all') {
          hasData = filteredData.todos.length > 0 || 
                   filteredData.events.length > 0 || 
                   filteredData.notes.length > 0;
        } else if (state.sidebar.currentTab === 'event') {
          hasData = filteredData.events.length > 0;
        } else if (state.sidebar.currentTab === 'todo') {
          hasData = filteredData.todos.length > 0;
        } else if (state.sidebar.currentTab === 'note') {
          hasData = filteredData.notes.length > 0;
        }

        // 创建日期分组
        const dateGroup = document.createElement('div');
        dateGroup.className = 'date-group';
        dateGroup.dataset.date = dateStr;

        // 日期标题
        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-group-header';
        const date = new Date(dateStr);
        const isToday = utils.isSameDay(date, new Date());
        const isSelected = utils.isSameDay(date, state.selectedDate);
        
        if (isToday) {
          dateHeader.textContent = '今天';
          dateHeader.style.color = 'var(--accent)';
        } else if (isSelected) {
          dateHeader.textContent = utils.formatSidebarDate(date);
          dateHeader.style.color = 'var(--accent)';
        } else {
          dateHeader.textContent = utils.formatSidebarDate(date);
        }
        dateGroup.appendChild(dateHeader);

        // 渲染事件
        if (state.sidebar.currentTab === 'all' || state.sidebar.currentTab === 'event') {
          filteredData.events.forEach(event => {
            dateGroup.appendChild(this.renderEventItem(event));
          });
        }

        // 渲染待办
        if (state.sidebar.currentTab === 'all' || state.sidebar.currentTab === 'todo') {
          filteredData.todos.forEach(todo => {
            dateGroup.appendChild(this.renderTodoItem(todo));
          });
        }

        // 渲染笔记
        if (state.sidebar.currentTab === 'all' || state.sidebar.currentTab === 'note') {
          filteredData.notes.forEach(note => {
            dateGroup.appendChild(this.renderNoteItem(note));
          });
        }

        container.appendChild(dateGroup);
      });

      // 显示加载更多提示
      if (state.sidebar.hasMoreBefore) {
        const loadMoreBefore = document.createElement('div');
        loadMoreBefore.className = 'load-more-indicator';
        loadMoreBefore.textContent = '↑ 点击加载更早';
        loadMoreBefore.style.cursor = 'pointer';
        loadMoreBefore.addEventListener('click', () => this.loadMoreData('before'));
        container.insertBefore(loadMoreBefore, container.firstChild);
      }

      if (state.sidebar.hasMoreAfter) {
        const loadMoreAfter = document.createElement('div');
        loadMoreAfter.className = 'load-more-indicator';
        loadMoreAfter.textContent = '↓ 点击加载更多';
        loadMoreAfter.style.cursor = 'pointer';
        loadMoreAfter.addEventListener('click', () => this.loadMoreData('after'));
        container.appendChild(loadMoreAfter);
      }

      // 如果没有数据
      if (container.children.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无数据</div>';
      }
    },

    // 过滤数据
    filterData(dayData) {
      const query = state.sidebar.searchQuery;
      
      const filterItems = (items) => {
        if (!query) return items;
        return items.filter(item => 
          (item.title && item.title.toLowerCase().includes(query)) ||
          (item.description && item.description.toLowerCase().includes(query))
        );
      };

      return {
        todos: filterItems(dayData.todos),
        events: filterItems(dayData.events),
        notes: filterItems(dayData.notes)
      };
    },

    // 渲染待办项
    renderTodoItem(todo) {
      const item = document.createElement('div');
      item.className = 'todo-item';

      let metaHtml = '';
      if (todo.priority) {
        metaHtml += `<span class="todo-priority ${utils.getPriorityClass(todo.priority)}">${utils.getPriorityLabel(todo.priority)}</span>`;
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

      // 事件绑定
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

      return item;
    },

    // 渲染事件项
    renderEventItem(event) {
      const item = document.createElement('div');
      item.className = 'event-item';
      item.style.borderLeftColor = event.color || '#2563eb';

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
        <div class="event-content" data-id="${event.isRecurringInstance ? event._originalId : event.id}">
          <div class="event-title">${utils.escapeHtml(event.title)}${event.isRecurringInstance ? ' <span class="recurrence-badge">重复</span>' : ''}</div>
          <div class="event-time">${timeHtml}</div>
        </div>
        <div class="event-actions">
          <button class="edit-btn" data-id="${event.isRecurringInstance ? event._originalId : event.id}" title="编辑">✎</button>
          <button class="delete-btn" data-id="${event.isRecurringInstance ? event._originalId : event.id}" title="删除">×</button>
        </div>
      `;

      const eventContent = item.querySelector('.event-content');
      eventContent.addEventListener('click', () => handlers.editEvent(event));

      const editBtn = item.querySelector('.edit-btn');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.editEvent(event);
      });

      const deleteBtn = item.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.deleteEvent(event.isRecurringInstance ? event._originalId : event.id);
      });

      return item;
    },

    // 渲染笔记项
    renderNoteItem(note) {
      const item = document.createElement('div');
      item.className = 'note-item';
      item.title = note.title;
      item.innerHTML = `<div class="note-title">${utils.escapeHtml(note.title)}</div>`;

      item.addEventListener('click', () => {
        window.open(`/?id=${note.id}`, '_blank');
      });

      return item;
    },

    // 刷新数据
    async refresh() {
      const dateStr = utils.formatDate(state.selectedDate);
      console.log('[sidebar] 刷新数据:', dateStr);
      await this.loadDayData(dateStr);
      this.render();
    }
  };

  // ==================== 渲染函数 ====================
  const render = {
    calendar() {
      elements.monthView.style.display = 'flex';
      this.renderMonthView();
    },

    async expandRecurringEvents(events, year, month) {
      const expanded = [];
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

      const lunarEvents = [];
      const otherEvents = [];

      events.forEach(event => {
        if (!event.recurrence) {
          expanded.push(event);
          return;
        }

        try {
          const recurrence = typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence;
          if (!recurrence || !recurrence.type) {
            expanded.push(event);
            return;
          }

          if (recurrence.type === 'lunar_monthly' || recurrence.type === 'lunar_yearly') {
            lunarEvents.push(event);
          } else {
            otherEvents.push(event);
          }
        } catch (e) {
          console.error('解析重复规则失败:', event, e);
          expanded.push(event);
        }
      });

      // 处理公历重复事件
      otherEvents.forEach(event => {
        try {
          const recurrence = typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence;
          const startDate = new Date(event.startTime * 1000);
          const endDate = event.recurrenceEnd ? new Date(event.recurrenceEnd * 1000) : null;

          if (recurrence.type === 'weekly' && !recurrence.daysOfWeek) {
            recurrence.daysOfWeek = [startDate.getDay()];
          }

          const current = new Date(startDate);
          let breakLoop = false;

          // 快进到月份开始
          if (current < monthStart) {
            let periodMs = 0;
            switch (recurrence.type) {
              case 'daily':
                periodMs = 24 * 60 * 60 * 1000 * (recurrence.interval || 1);
                break;
              case 'weekly':
                periodMs = 7 * 24 * 60 * 60 * 1000 * (recurrence.interval || 1);
                break;
              case 'monthly':
                const yearDiff = monthStart.getFullYear() - current.getFullYear();
                const monthDiff = monthStart.getMonth() - current.getMonth();
                const totalMonths = yearDiff * 12 + monthDiff;
                const periodsToSkip = Math.max(0, totalMonths);
                current.setMonth(current.getMonth() + periodsToSkip * (recurrence.interval || 1));
                periodMs = 0;
                break;
              case 'yearly':
                periodMs = 365 * 24 * 60 * 60 * 1000 * (recurrence.interval || 1);
                break;
            }

            if (periodMs > 0) {
              const periodsToSkip = Math.ceil((monthStart - current) / periodMs);
              current.setTime(current.getTime() + periodsToSkip * periodMs);
            }
          }

          while ((!endDate || current <= endDate) && current <= monthEnd) {
            let shouldAdd = true;
            if (recurrence.type === 'weekly' && recurrence.daysOfWeek) {
              shouldAdd = recurrence.daysOfWeek.includes(current.getDay());
            }

            if (shouldAdd) {
              expanded.push({
                ...event,
                _originalId: event.id,
                _instanceTime: Math.floor(current.getTime() / 1000),
                isRecurringInstance: true,
                startTime: Math.floor(current.getTime() / 1000),
                endTime: event.endTime ?
                  Math.floor(current.getTime() / 1000 + (event.endTime - event.startTime)) :
                  null
              });
            }

            switch (recurrence.type) {
              case 'daily':
                current.setDate(current.getDate() + (recurrence.interval || 1));
                break;
              case 'weekly':
                current.setDate(current.getDate() + 1);
                break;
              case 'monthly':
                current.setMonth(current.getMonth() + (recurrence.interval || 1));
                break;
              case 'yearly':
                current.setFullYear(current.getFullYear() + (recurrence.interval || 1));
                break;
              default:
                breakLoop = true;
                break;
            }

            if (breakLoop) break;
          }
        } catch (e) {
          console.error('展开重复事件失败:', event, e);
          expanded.push(event);
        }
      });

      // 处理农历重复事件
      if (lunarEvents.length > 0) {
        const startDate = Math.floor(monthStart.getTime() / 1000);
        const endDate = Math.floor(monthEnd.getTime() / 1000);

        try {
          const response = await fetch(`/api/events/expand-lunar?startDate=${startDate}&endDate=${endDate}`, {
            credentials: 'include'
          });

          if (response.ok) {
            const lunarExpanded = await response.json();
            lunarExpanded.forEach(instance => {
              expanded.push({
                ...instance,
                _originalId: instance.parentEventId || instance._originalId || instance.id,
                isRecurringInstance: true
              });
            });
          }
        } catch (error) {
          console.error('获取农历重复事件失败:', error);
        }
      }

      return expanded;
    },

    renderMonthView() {
      const year = state.currentDate.getFullYear();
      const month = state.currentDate.getMonth();

      elements.currentMonth.textContent = `${year}年${month + 1}月`;

      if (elements.monthViewGrid) {
        elements.monthViewGrid.innerHTML = '';
      }

      const isNarrow = window.innerWidth <= 768;

      if (isNarrow) {
        this.renderNarrowWeekView();
      } else {
        this.renderFullMonthView(year, month);
      }

      dataLoader.loadMonthData(year, month);

      if (isNarrow) {
        this.loadWeekLunarDates();
      } else {
        this.loadLunarDates(year, month);
      }
    },

    renderFullMonthView(year, month) {
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startDayOfWeek = firstDay.getDay();
      const totalDays = lastDay.getDate();
      const prevLastDay = new Date(year, month, 0).getDate();

      for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevLastDay - i;
        const dateStr = utils.formatDate(new Date(year, month - 1, day));
        this.createMonthDayCell(day, dateStr, true);
      }

      for (let i = 1; i <= totalDays; i++) {
        const date = new Date(year, month, i);
        const dateStr = utils.formatDate(date);
        const isToday = utils.isSameDay(date, new Date());
        const isSelected = utils.isSameDay(date, state.selectedDate);
        this.createMonthDayCell(i, dateStr, false, isToday, isSelected);
      }

      const remainingCells = 42 - (startDayOfWeek + totalDays);
      for (let i = 1; i <= remainingCells; i++) {
        const dateStr = utils.formatDate(new Date(year, month + 1, i));
        this.createMonthDayCell(i, dateStr, true);
      }

      this.loadLunarDates(year, month);
    },

    async loadLunarDates(year, month) {
      try {
        const cacheKey = `${year}-${month}`;
        let lunarData = state.lunarCache.get(cacheKey);

        if (!lunarData) {
          const response = await fetch(`/api/lunar/month/${year}/${month + 1}`, {
            credentials: 'include'
          });

          if (response.ok) {
            lunarData = await response.json();
            state.lunarCache.set(cacheKey, lunarData);
          } else {
            return;
          }
        }

        const lastDay = new Date(year, month + 1, 0).getDate();

        for (let i = 1; i <= lastDay; i++) {
          const dateStr = utils.formatDate(new Date(year, month, i));
          const lunarEl = document.getElementById(`day-lunar-${dateStr}`);

          if (lunarEl && lunarData[dateStr]) {
            const data = lunarData[dateStr];
            lunarEl.textContent = data.lunarDayCn;
            if (data.festival) {
              lunarEl.textContent = data.festival;
              lunarEl.classList.add('day-festival');
            }
          }
        }
      } catch (error) {
        console.error('批量加载农历日期失败:', error);
      }
    },

    async loadWeekLunarDates() {
      try {
        const selectedDayOfWeek = state.selectedDate.getDay();
        const weekStart = new Date(state.selectedDate);
        weekStart.setDate(state.selectedDate.getDate() - selectedDayOfWeek);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        const monthsToLoad = new Set();
        let current = new Date(weekStart);
        while (current <= weekEnd) {
          monthsToLoad.add(`${current.getFullYear()}-${current.getMonth()}`);
          current.setDate(current.getDate() + 1);
        }

        for (const cacheKey of monthsToLoad) {
          if (!state.lunarCache.has(cacheKey)) {
            const [y, m] = cacheKey.split('-').map(Number);
            try {
              const response = await fetch(`/api/lunar/month/${y}/${m + 1}`, {
                credentials: 'include'
              });
              if (response.ok) {
                const lunarData = await response.json();
                state.lunarCache.set(cacheKey, lunarData);
              }
            } catch (error) {
              console.error(`加载农历数据失败: ${cacheKey}`, error);
            }
          }
        }

        for (let i = 0; i < 7; i++) {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + i);
          const dateStr = utils.formatDate(date);
          const lunarEl = document.getElementById(`day-lunar-${dateStr}`);
          
          const cacheKey = `${date.getFullYear()}-${date.getMonth()}`;
          const lunarData = state.lunarCache.get(cacheKey);

          if (lunarEl && lunarData && lunarData[dateStr]) {
            const data = lunarData[dateStr];
            lunarEl.textContent = data.lunarDayCn;
            if (data.festival) {
              lunarEl.textContent = data.festival;
              lunarEl.classList.add('day-festival');
            }
          }
        }
      } catch (error) {
        console.error('加载周农历日期失败:', error);
      }
    },

    renderNarrowWeekView() {
      const selectedDayOfWeek = state.selectedDate.getDay();
      const weekStart = new Date(state.selectedDate);
      weekStart.setDate(state.selectedDate.getDate() - selectedDayOfWeek);

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
      cell.dataset.dateStr = dateStr;
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

      if (elements.monthViewGrid) {
        elements.monthViewGrid.appendChild(cell);
      }
    },

    async updateMonthIndicators() {
      const year = state.currentDate.getFullYear();
      const month = state.currentDate.getMonth();

      elements.monthView.querySelectorAll('.day-content').forEach(container => {
        container.innerHTML = '';
      });

      elements.monthView.querySelectorAll('.day-summary').forEach(container => {
        container.innerHTML = '';
      });

      const dateMap = new Map();

      state.currentMonthTodos.forEach(todo => {
        if (todo.dueDate) {
          const dateKey = utils.formatDate(new Date(todo.dueDate * 1000));
          const existing = dateMap.get(dateKey) || { todos: [], events: [], notes: [] };
          existing.todos.push(todo);
          dateMap.set(dateKey, existing);
        }
      });

      const expandedEvents = await this.expandRecurringEvents(state.currentMonthEvents, year, month);

      expandedEvents.forEach(event => {
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

      state.currentMonthNotes.forEach(note => {
        let timestamp = null;
        if (note.updatedAt) {
          timestamp = note.updatedAt;
        } else if (note.createdAt) {
          timestamp = note.createdAt;
        } else if (note.date) {
          timestamp = note.date;
        }

        if (timestamp) {
          const dateKey = utils.formatDate(new Date(timestamp));
          const existing = dateMap.get(dateKey) || { todos: [], events: [], notes: [] };
          existing.notes.push(note);
          dateMap.set(dateKey, existing);
        }
      });

      dateMap.forEach((data, dateStr) => {
        const container = document.getElementById(`day-content-${dateStr}`);
        const summaryContainer = document.getElementById(`day-summary-${dateStr}`);

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
          const items = [];

          data.events.slice(0, 5).forEach(event => {
            items.push({ type: 'event', data: event });
          });

          if (items.length < 5) {
            data.todos.slice(0, 5 - items.length).forEach(todo => {
              items.push({ type: 'todo', data: todo });
            });
          }

          items.forEach(item => {
            const div = document.createElement('div');
            div.className = `day-preview-item ${item.type}`;
            div.textContent = item.data.title;
            div.title = item.data.title;
            container.appendChild(div);
          });

          const totalItems = data.events.length + data.todos.length;
          if (totalItems > 5) {
            const more = document.createElement('div');
            more.className = 'day-more';
            more.textContent = `+${totalItems - 5}`;
            container.appendChild(more);
          }
        }
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

        await render.updateMonthIndicators();
      } catch (error) {
        console.error('加载月份数据失败:', error);
        state.currentMonthTodos = [];
        state.currentMonthEvents = [];
        state.currentMonthNotes = [];
      }
    }
  };

  // ==================== 事件处理 ====================
  const handlers = {
    prevMonth() {
      state.currentDate.setMonth(state.currentDate.getMonth() - 1);
      render.calendar();
      sidebarRenderer.refresh();
    },

    nextMonth() {
      state.currentDate.setMonth(state.currentDate.getMonth() + 1);
      render.calendar();
      sidebarRenderer.refresh();
    },

    today() {
      state.currentDate = new Date();
      state.selectedDate = new Date();
      render.calendar();
      sidebarRenderer.refresh();
    },

    selectDate(dateStr) {
      state.selectedDate = new Date(dateStr);
      elements.sidebarDate.textContent = utils.formatSidebarDate(state.selectedDate);
      render.calendar();
      sidebarRenderer.refresh();
    },

    openTodoModal() {
      if (!elements.todoForm.dataset.todoId) {
        const dueDateInput = elements.todoForm.querySelector('[name="dueDate"]');
        dueDateInput.value = utils.formatDate(state.selectedDate);
        const modalTitle = elements.todoModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加待办事项';
      }
      elements.todoModal.classList.add('show');
    },

    openEventModal() {
      if (!elements.eventForm.dataset.eventId) {
        const startTimeInput = elements.eventForm.querySelector('[name="startTime"]');
        const endTimeInput = elements.eventForm.querySelector('[name="endTime"]');
        const allDayInput = elements.eventForm.querySelector('[name="allDay"]');

        const dateStr = utils.formatDate(state.selectedDate);
        startTimeInput.value = `${dateStr}T09:00`;
        endTimeInput.value = `${dateStr}T18:00`;
        allDayInput.value = 'false';
        const modalTitle = elements.eventModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加事件';
      }
      elements.eventModal.classList.add('show');
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
        sidebarRenderer.refresh();
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

      const eventId = elements.eventForm.dataset.eventId;

      if (data.startTime) {
        data.startTime = Math.floor(new Date(data.startTime).getTime() / 1000);
      }
      if (data.endTime) {
        data.endTime = Math.floor(new Date(data.endTime).getTime() / 1000);
      }
      data.allDay = data.allDay === 'true';

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
          await api.updateEvent(eventId, data);
        } else {
          await api.createEvent(data);
        }
        this.closeModals();
        delete elements.eventForm.dataset.eventId;
        const modalTitle = elements.eventModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加事件';

        sidebarRenderer.refresh();
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('保存事件失败:', error);
        alert('保存失败，请重试');
      }
    },

    async toggleTodo(id, completed) {
      try {
        await api.toggleTodo(id, completed);
        sidebarRenderer.refresh();
      } catch (error) {
        console.error('切换待办状态失败:', error);
      }
    },

    async deleteTodo(id) {
      if (!confirm('确定要删除这个待办事项吗？')) return;

      try {
        await api.deleteTodo(id);
        sidebarRenderer.refresh();
        dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
      } catch (error) {
        console.error('删除待办事项失败:', error);
      }
    },

    editTodo(todo) {
      elements.todoForm.querySelector('[name="title"]').value = todo.title || '';
      elements.todoForm.querySelector('[name="description"]').value = todo.description || '';
      elements.todoForm.querySelector('[name="priority"]').value = todo.priority || 2;
      elements.todoForm.querySelector('[name="dueDate"]').value = todo.dueDate ? utils.formatDate(new Date(todo.dueDate * 1000)) : '';

      elements.todoForm.dataset.todoId = todo.id;
      const modalTitle = elements.todoModal.querySelector('.modal-title');
      if (modalTitle) modalTitle.textContent = '编辑待办事项';

      this.openTodoModal();
    },

    async deleteEvent(id) {
      if (id && typeof id === 'string' && id.includes('_')) {
        const originalId = id.split('_')[0];
        if (confirm('这是一个重复事件实例。确定要删除整个重复事件系列吗？')) {
          try {
            await api.deleteEvent(originalId);
            sidebarRenderer.refresh();
            dataLoader.loadMonthData(state.currentDate.getFullYear(), state.currentDate.getMonth());
          } catch (error) {
            console.error('删除事件失败:', error);
            alert('删除失败，请重试');
          }
        }
        return;
      }

      if (!confirm('确定要删除这个事件吗？')) return;

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
      elements.eventForm.querySelector('[name="startTime"]').value = new Date(event.startTime * 1000).toISOString().slice(0, 16);
      elements.eventForm.querySelector('[name="endTime"]').value = event.endTime ? new Date(event.endTime * 1000).toISOString().slice(0, 16) : '';
      elements.eventForm.querySelector('[name="allDay"]').checked = event.allDay === 1;
      elements.eventForm.querySelector('[name="color"]').value = event.color || '#2563eb';

      if (event.recurrence) {
        try {
          const recurrenceObj = typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence;
          elements.eventForm.querySelector('[name="recurrence"]').value = recurrenceObj.type || '';
          if (event.recurrenceEnd) {
            const endDate = new Date(event.recurrenceEnd * 1000);
            elements.eventForm.querySelector('[name="recurrenceEnd"]').value = endDate.toISOString().slice(0, 10);
            document.getElementById('recurrence-end-group').style.display = 'block';
          } else {
            elements.eventForm.querySelector('[name="recurrenceEnd"]').value = '';
            document.getElementById('recurrence-end-group').style.display = 'none';
          }
        } catch (e) {
          console.error('解析recurrence失败:', e);
          elements.eventForm.querySelector('[name="recurrence"]').value = '';
          elements.eventForm.querySelector('[name="recurrenceEnd"]').value = '';
          document.getElementById('recurrence-end-group').style.display = 'none';
        }
      } else {
        elements.eventForm.querySelector('[name="recurrence"]').value = '';
        elements.eventForm.querySelector('[name="recurrenceEnd"]').value = '';
        document.getElementById('recurrence-end-group').style.display = 'none';
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
    },

    async exportCalendar() {
      try {
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

          render.calendar();
          sidebarRenderer.refresh();
        }
      } catch (error) {
        console.error('导入日历失败:', error);
        alert('导入失败,请检查文件格式');
      } finally {
        e.target.value = '';
      }
    },

    openSubscriptionModal: () => {
      document.getElementById('subscription-modal').classList.add('show');
      handlers.loadSubscriptions();
    },

    openSubscriptionForm: (subscription = null) => {
      const modal = document.getElementById('subscription-form-modal');
      const title = document.getElementById('subscription-form-title');
      const form = document.getElementById('subscription-form');

      title.textContent = subscription ? '编辑订阅' : '添加订阅';

      if (subscription) {
        form.dataset.subscriptionId = subscription.id;
        form.name.value = subscription.name;
        form.url.value = subscription.url;
        form.color.value = subscription.color;
      } else {
        delete form.dataset.subscriptionId;
        form.reset();
        form.color.value = '#6366f1';
      }

      modal.classList.add('show');
    },

    closeSubscriptionModals: () => {
      document.getElementById('subscription-modal').classList.remove('show');
      document.getElementById('subscription-form-modal').classList.remove('show');
    },

    async loadSubscriptions() {
      try {
        const response = await fetch('/api/calendar-subscriptions', {
          credentials: 'include'
        });

        if (!response.ok) throw new Error('获取订阅失败');

        const subscriptions = await response.json();
        handlers.renderSubscriptions(subscriptions);
      } catch (error) {
        console.error('加载订阅失败:', error);
        alert('加载订阅失败');
      }
    },

    renderSubscriptions(subscriptions) {
      const container = document.getElementById('subscription-list');

      if (!subscriptions || subscriptions.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无订阅</div>';
        return;
      }

      container.innerHTML = subscriptions.map(sub => `
        <div class="subscription-item" style="display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 8px; background: var(--bg);">
          <div style="width: 20px; height: 20px; border-radius: 4px; background: ${sub.color}; flex-shrink: 0;"></div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 13px; color: var(--text);">${sub.name}</div>
            <div style="font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${sub.url}</div>
          </div>
          <div style="display: flex; gap: 4px; flex-shrink: 0;">
            <button type="button" onclick="handlers.syncSubscription('${sub.id}')" style="padding: 4px 8px; font-size: 11px; background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer;">同步</button>
            <button type="button" onclick="handlers.editSubscription('${sub.id}')" style="padding: 4px 8px; font-size: 11px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">编辑</button>
            <button type="button" onclick="handlers.deleteSubscription('${sub.id}')" style="padding: 4px 8px; font-size: 11px; background: #fee2e2; color: #dc2626; border: none; border-radius: 4px; cursor: pointer;">删除</button>
          </div>
        </div>
      `).join('');
    },

    async handleSubscriptionSubmit(e) {
      e.preventDefault();
      const form = e.target;
      const formData = new FormData(form);

      const subscriptionId = form.dataset.subscriptionId;
      const data = {
        name: formData.get('name'),
        url: formData.get('url'),
        color: formData.get('color')
      };

      try {
        const url = subscriptionId
          ? `/api/calendar-subscriptions/${subscriptionId}`
          : '/api/calendar-subscriptions';
        const method = subscriptionId ? 'PUT' : 'POST';

        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(data)
        });

        if (!response.ok) throw new Error('保存失败');

        alert('保存成功');
        handlers.closeSubscriptionModals();
        handlers.loadSubscriptions();
      } catch (error) {
        console.error('保存订阅失败:', error);
        alert('保存失败');
      }
    },

    async syncSubscription(id) {
      try {
        const response = await fetch(`/api/calendar-subscriptions/${id}/sync`, {
          method: 'POST',
          credentials: 'include'
        });

        if (!response.ok) throw new Error('同步失败');

        const result = await response.json();
        alert(`同步成功!共导入 ${result.imported} 个事件`);

        render.calendar();
        sidebarRenderer.refresh();
      } catch (error) {
        console.error('同步订阅失败:', error);
        alert('同步失败');
      }
    },

    async editSubscription(id) {
      try {
        const response = await fetch(`/api/calendar-subscriptions`, {
          credentials: 'include'
        });

        if (!response.ok) throw new Error('获取订阅失败');

        const subscriptions = await response.json();
        const subscription = subscriptions.find(s => s.id === id);

        if (subscription) {
          handlers.openSubscriptionForm(subscription);
        }
      } catch (error) {
        console.error('获取订阅失败:', error);
        alert('获取订阅失败');
      }
    },

    async deleteSubscription(id) {
      if (!confirm('确定要删除这个订阅吗？这将同时删除该订阅的所有事件。')) return;

      try {
        const response = await fetch(`/api/calendar-subscriptions/${id}`, {
          method: 'DELETE',
          credentials: 'include'
        });

        if (!response.ok) throw new Error('删除失败');

        alert('删除成功');
        handlers.loadSubscriptions();

        render.calendar();
        sidebarRenderer.refresh();
      } catch (error) {
        console.error('删除订阅失败:', error);
        alert('删除失败');
      }
    }
  };

  // ==================== 初始化 ====================
  async function checkAuth() {
    try {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const response = await fetch(`/api/events/calendar/day/${dateStr}`, {
        credentials: 'include'
      });
      if (response.status === 401) {
        return false;
      }
      return true;
    } catch (error) {
      console.error('[CalendarApp] 检查登录状态失败:', error);
      return false;
    }
  }

  async function init() {
    console.log('[CalendarApp] 初始化开始...');

    const isLoggedIn = await checkAuth();
    const loginRequiredEl = document.getElementById('login-required');

    if (!isLoggedIn) {
      if (loginRequiredEl) {
        loginRequiredEl.classList.add('show');
      }
      console.log('[CalendarApp] 未登录，停止初始化');
      return;
    }

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
    const subscriptionBtn = document.getElementById('subscription-btn');
    const icsFileInput = document.getElementById('ics-file-input');

    if (prevMonthBtn) prevMonthBtn.addEventListener('click', handlers.prevMonth);
    if (nextMonthBtn) nextMonthBtn.addEventListener('click', handlers.nextMonth);
    if (todayBtn) todayBtn.addEventListener('click', handlers.today);
    if (todoAddBtn) todoAddBtn.addEventListener('click', handlers.openTodoModal);
    if (eventAddBtn) eventAddBtn.addEventListener('click', handlers.openEventModal);
    if (newEventBtn) newEventBtn.addEventListener('click', handlers.openEventModal);
    if (subscriptionBtn) subscriptionBtn.addEventListener('click', handlers.openSubscriptionModal);
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

    // 使用事件委托处理日期单元格点击
    if (elements.monthViewGrid) {
      elements.monthViewGrid.addEventListener('click', (e) => {
        const cell = e.target.closest('.month-day');
        if (cell && cell.dataset.dateStr) {
          handlers.selectDate(cell.dataset.dateStr);
        }
      });
    }

    // 监听窗口大小变化
    window.addEventListener('resize', utils.debounce(async () => {
      render.calendar();
      await render.updateMonthIndicators();
    }, 200));

    // 绑定表单提交
    if (elements.todoForm) {
      elements.todoForm.addEventListener('submit', (e) => handlers.handleTodoSubmit(e));
    }
    if (elements.eventForm) {
      elements.eventForm.addEventListener('submit', (e) => handlers.handleEventSubmit(e));
    }

    // 绑定订阅表单
    const subscriptionForm = document.getElementById('subscription-form');
    if (subscriptionForm) {
      subscriptionForm.addEventListener('submit', (e) => handlers.handleSubscriptionSubmit(e));
    }
    const addSubscriptionBtn = document.getElementById('add-subscription-btn');
    if (addSubscriptionBtn) {
      addSubscriptionBtn.addEventListener('click', () => handlers.openSubscriptionForm());
    }

    // 模态框关闭事件
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

    document.querySelectorAll('.todo-modal-close, .event-modal-close').forEach(btn => {
      btn.addEventListener('click', handlers.closeModals);
    });

    document.querySelectorAll('.todo-modal-cancel, .event-modal-cancel').forEach(btn => {
      btn.addEventListener('click', handlers.closeModals);
    });

    document.querySelectorAll('.subscription-modal-close, .subscription-form-modal-close, .subscription-form-cancel').forEach(btn => {
      btn.addEventListener('click', handlers.closeSubscriptionModals);
    });

    const subscriptionModal = document.getElementById('subscription-modal');
    if (subscriptionModal) {
      subscriptionModal.addEventListener('click', (e) => {
        if (e.target === subscriptionModal) handlers.closeSubscriptionModals();
      });
    }

    const subscriptionFormModal = document.getElementById('subscription-form-modal');
    if (subscriptionFormModal) {
      subscriptionFormModal.addEventListener('click', (e) => {
        if (e.target === subscriptionFormModal) handlers.closeSubscriptionModals();
      });
    }

    // ESC键关闭模态框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') handlers.closeModals();
    });

    // 初始化侧边栏
    sidebarRenderer.init();

    // 初始渲染
    render.calendar();
    elements.sidebarDate.textContent = utils.formatSidebarDate(state.selectedDate);

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
