window.createCalendarRender = function createCalendarRender(dependencies) {
  const { state, elements, utils, api } = dependencies;
  // ==================== 渲染函数 ====================
  const getDataLoader = () => dependencies.dataLoader;
  return {
    calendar() {
      elements.monthView.style.display = 'flex';
      this.renderMonthView();
    },

    async expandRecurringEvents(events, year, month) {
      const expanded = [];
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
      const recurringMasters = [];

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
          recurringMasters.push(event);
        } catch (e) {
          console.error('解析重复规则失败:', event, e);
          expanded.push(event);
        }
      });

      if (recurringMasters.length > 0) {
        const startDate = Math.floor(monthStart.getTime() / 1000);
        const endDate = Math.floor(monthEnd.getTime() / 1000);

        try {
          const response = await fetch(`/api/events/expand-recurring?startDate=${startDate}&endDate=${endDate}`, {
            credentials: 'include'
          });

          if (response.ok) {
            const recurringExpanded = await response.json();
            recurringExpanded.forEach(instance => {
              expanded.push({
                ...instance,
                _originalId: instance.parentEventId || instance._originalId || instance.id,
                isRecurringInstance: true
              });
            });
          }
        } catch (error) {
          console.error('获取重复事件失败:', error);
        }
      }

      return expanded;
    },

    renderMonthView() {
      const year = state.currentDate.getFullYear();
      const month = state.currentDate.getMonth();

      elements.currentMonth.textContent = `${year}年${month + 1}月`;

      // 同步跳转输入框
      const jumpYear = document.getElementById('jump-year');
      const jumpMonth = document.getElementById('jump-month');
      if (jumpYear) jumpYear.value = year;
      if (jumpMonth) jumpMonth.value = month + 1;

      if (elements.monthViewGrid) {
        elements.monthViewGrid.innerHTML = '';
      }

      this.renderFullMonthView(year, month);
      getDataLoader().loadMonthData(year, month);
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
      const monthLabel = `${year}年${month + 1}月`;

      if (elements.currentMonth) {
        elements.currentMonth.textContent = monthLabel;
        elements.currentMonth.classList.remove('hidden');
      }

      const bannerText = document.getElementById('calendar-month-banner-text');
      if (bannerText) {
        bannerText.textContent = monthLabel;
      }

      const renderToken = Symbol('renderToken');
      this.currentRenderToken = renderToken;

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

      // Render Guard: abort if a newer render cycle has started
      if (this.currentRenderToken !== renderToken) {
        return;
      }

      expandedEvents.forEach(event => {
        let startDate, actualLoopEnd;

        if (event.allDay) {
          // 全天事件使用 UTC 解释
          const dStart = new Date(event.startTime * 1000);
          startDate = new Date(dStart.getUTCFullYear(), dStart.getUTCMonth(), dStart.getUTCDate());

          const dEnd = event.endTime ? new Date(event.endTime * 1000 - 1000) : dStart;
          actualLoopEnd = new Date(dEnd.getUTCFullYear(), dEnd.getUTCMonth(), dEnd.getUTCDate(), 23, 59, 59);
        } else {
          startDate = new Date(event.startTime * 1000);
          const endDate = event.endTime ? new Date(event.endTime * 1000) : startDate;
          actualLoopEnd = new Date(endDate);
          actualLoopEnd.setHours(23, 59, 59, 999);
        }

        const current = new Date(startDate);
        while (current <= actualLoopEnd) {
          const dateKey = utils.formatDate(current);
          const existing = dateMap.get(dateKey) || { todos: [], events: [], notes: [] };
          existing.events.push(event);
          dateMap.set(dateKey, existing);

          // 进位到下一天
          const nextDay = new Date(current);
          nextDay.setDate(current.getDate() + 1);
          if (nextDay > actualLoopEnd) break;
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
          container.innerHTML = '';
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

};

window.createCalendarDataLoader = function createCalendarDataLoader(dependencies) {
  const { state, api } = dependencies;
  // ==================== 数据加载 ====================
  return {
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

        await dependencies.render.updateMonthIndicators();
      } catch (error) {
        console.error('加载月份数据失败:', error);
        state.currentMonthTodos = [];
        state.currentMonthEvents = [];
        state.currentMonthNotes = [];
      }
    }
  };
};
