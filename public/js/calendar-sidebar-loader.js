window.createCalendarSidebarLoader = function createCalendarSidebarLoader(dependencies) {
  const { state, elements, utils, api } = dependencies;

  return {
    // 加载所有事件数据
    async loadAllEvents() {
      try {
        const response = await fetch('/api/events', {
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const allEvents = await response.json();
        state.allEvents = allEvents;

        // 只清空现有的事件数据，保留待办和笔记
        state.sidebar.dataByDate.forEach(data => {
          data.events = [];
        });

        allEvents.forEach(event => {
          if (!event.startTime) return;
          const dateStr = utils.formatDate(new Date(event.startTime * 1000));
          if (!state.sidebar.dataByDate.has(dateStr)) {
            state.sidebar.dataByDate.set(dateStr, { todos: [], events: [], notes: [] });
          }
          const dayData = state.sidebar.dataByDate.get(dateStr);
          dayData.events.push(event);
        });

        this.render();
      } catch (error) {
        console.error('加载事件失败:', error);
      }
    },

    // 加载所有待办事项数据
    async loadAllTodos() {
      // 直接从API获取所有待办事项
      try {
        const response = await fetch('/api/todos', {
          credentials: 'include'
        });

        if (response.ok) {
          const allTodos = await response.json();
          state.allTodos = allTodos; // 保存到全局状态

          // 更新待办事项数量
          const incompleteCountEl = document.getElementById('incomplete-count');
          if (incompleteCountEl) {
            const incompleteTodos = allTodos.filter(t => !t.completed);
            incompleteCountEl.textContent = incompleteTodos.length;
          }

          // 只清空现有的待办数据，保留事件和笔记
          state.sidebar.dataByDate.forEach(data => {
            data.todos = [];
          });

          // 将待办事项按状态和日期分组
          allTodos.forEach(todo => {
            if (todo.dueDate) {
              const dateStr = utils.formatDate(new Date(todo.dueDate * 1000));
              if (!state.sidebar.dataByDate.has(dateStr)) {
                state.sidebar.dataByDate.set(dateStr, { todos: [], events: [], notes: [] });
              }
              const dayData = state.sidebar.dataByDate.get(dateStr);
              dayData.todos.push(todo);
            } else {
              // 没有截止日期的待办事项放在今天
              const todayStr = utils.formatDate(new Date());
              if (!state.sidebar.dataByDate.has(todayStr)) {
                state.sidebar.dataByDate.set(todayStr, { todos: [], events: [], notes: [] });
              }
              const dayData = state.sidebar.dataByDate.get(todayStr);
              dayData.todos.push(todo);
            }
          });

          // 加载完成后立即渲染
          this.render();
        }
      } catch (error) {
        console.error('加载待办事项失败:', error);
      }
    },

    // 更新未完成待办事项数量
    async updateIncompleteCount() {
      try {
        const response = await fetch('/api/todos', {
          credentials: 'include'
        });

        if (response.ok) {
          const allTodos = await response.json();
          const incompleteTodos = allTodos.filter(t => !t.completed);
          const incompleteCountEl = document.getElementById('incomplete-count');
          if (incompleteCountEl) {
            incompleteCountEl.textContent = incompleteTodos.length;
          }
        }
      } catch (error) {
        console.error('更新未完成待办事项数量失败:', error);
      }
    },

    // 加载初始数据（选中日期前后各预载数天）
    async loadInitialData() {
      const selectedDate = state.selectedDate;
      const preloadDays = state.sidebar.visibleDays || 7;

      state.sidebar.dataByDate.clear();
      state.sidebar.rangeBeforeDays = 0;
      state.sidebar.rangeAfterDays = 0;
      state.sidebar.hasMoreBefore = true;
      state.sidebar.hasMoreAfter = true;

      const pendingLoads = [];
      for (let offset = -preloadDays; offset <= preloadDays; offset++) {
        const targetDate = new Date(selectedDate);
        targetDate.setDate(selectedDate.getDate() + offset);
        pendingLoads.push(this.loadDayData(utils.formatDate(targetDate)));
      }

      await Promise.all(pendingLoads);
      this.render();
    },

    // 加载单天数据
    async loadDayData(dateStr) {
      try {
        const data = await api.getDayData(dateStr);

        if (!state.sidebar.dataByDate.has(dateStr)) {
          state.sidebar.dataByDate.set(dateStr, { todos: [], events: [], notes: [] });
        }

        const dayData = state.sidebar.dataByDate.get(dateStr);
        dayData.todos = data.todos;
        dayData.events = data.events;
        dayData.notes = data.notes;

      } catch (error) {
        console.error('加载单天数据失败:', error);
      }
    },

    async loadFutureRecurringEvents() {
      try {
        const response = await fetch('/api/events', {
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const allEvents = await response.json();
        const selectedDate = new Date(state.selectedDate);
        selectedDate.setHours(0, 0, 0, 0);
        const startTs = Math.floor(selectedDate.getTime() / 1000);

        const recurringMasters = allEvents.filter(event => {
          if (!event || !event.recurrence) return false;
          try {
            const recurrence = typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence;
            return !!(recurrence && recurrence.type);
          } catch (error) {
            return false;
          }
        });

        if (recurringMasters.length === 0) {
          state.sidebar.futureRecurringEvents = [];
          return;
        }

        const defaultEnd = new Date(selectedDate);
        defaultEnd.setFullYear(defaultEnd.getFullYear() + 3);
        defaultEnd.setHours(23, 59, 59, 999);

        const maxEndTs = recurringMasters.reduce((max, event) => {
          const recurrenceEnd = Number(event.recurrenceEnd || 0);
          return recurrenceEnd > max ? recurrenceEnd : max;
        }, Math.floor(defaultEnd.getTime() / 1000));

        const expandResponse = await fetch(`/api/events/expand-recurring?startDate=${startTs}&endDate=${maxEndTs}`, {
          credentials: 'include'
        });

        if (!expandResponse.ok) {
          throw new Error(`HTTP ${expandResponse.status}`);
        }

        const instances = await expandResponse.json();
        state.sidebar.futureRecurringEvents = instances
          .filter(event => event && event.startTime >= startTs)
          .map(event => ({
            ...event,
            _originalId: event.parentEventId || event._originalId || event.id,
            isRecurringInstance: true
          }))
          .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
      } catch (error) {
        console.error('加载未来重复事件失败:', error);
        state.sidebar.futureRecurringEvents = [];
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

    // 加载更多数据（仅由点击“加载更早/更多”触发）
    async loadMoreData(direction) {
      if (state.sidebar.isLoadingMore) return;

      state.sidebar.isLoadingMore = true;
      if (state.sidebar.currentTab !== 'todo') {
        if (!state.sidebar.expandedRangeTabs[state.sidebar.currentTab]) {
          state.sidebar.rangeBeforeDays = 0;
          state.sidebar.rangeAfterDays = 0;
        }
        state.sidebar.expandedRangeTabs[state.sidebar.currentTab] = true;
      }
      this.showLoadingIndicator(direction);

      try {
        const selectedDate = state.selectedDate;

        const targetDate = new Date(selectedDate);
        let nextRangeDays;
        if (direction === 'before') {
          nextRangeDays = (state.sidebar.rangeBeforeDays || 0) + 1;
          state.sidebar.rangeBeforeDays = nextRangeDays;
          targetDate.setDate(selectedDate.getDate() - nextRangeDays);
        } else {
          nextRangeDays = (state.sidebar.rangeAfterDays || 0) + 1;
          state.sidebar.rangeAfterDays = nextRangeDays;
          targetDate.setDate(selectedDate.getDate() + nextRangeDays);
        }

        const dateStr = utils.formatDate(targetDate);
        if (!state.sidebar.dataByDate.has(dateStr)) {
          await this.loadDayData(dateStr);
        }

        if (nextRangeDays >= 90) {
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

    showLoadingIndicator(direction) {
      const indicator = document.createElement('div');
      indicator.className = 'load-more-indicator loading';
      indicator.id = `loading-${direction}`;
      indicator.textContent = direction === 'before' ? '↑ 加载中...' : '↓ 加载中...';

      const container = elements.sidebarContent;
      if (!container) return;
      if (direction === 'before') {
        container.insertBefore(indicator, container.firstChild);
      } else {
        container.appendChild(indicator);
      }
    },

    hideLoadingIndicator(direction) {
      const indicator = document.getElementById(`loading-${direction}`);
      if (indicator) {
        indicator.remove();
      }
    }
  };
};
