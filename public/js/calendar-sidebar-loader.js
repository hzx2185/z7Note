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

    // 加载初始数据（只加载选中日期当天）
    async loadInitialData() {
      const selectedDate = state.selectedDate;
      const preloadDays = 7;

      state.sidebar.dataByDate.clear();
      state.sidebar.loadedDays = preloadDays;
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

    // 处理滚动加载
    async handleScroll() {
      if (state.sidebar.isLoadingMore) return;

      const container = document.scrollingElement || document.documentElement;
      if (!container) return;
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
      if (state.sidebar.currentTab === 'all' || state.sidebar.currentTab === 'event') {
        state.sidebar.expandedRangeTabs[state.sidebar.currentTab] = true;
      }
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
    }
  };
};
