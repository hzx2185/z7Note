window.createCalendarSidebarRenderer = function createCalendarSidebarRenderer(dependencies) {
  const { state, elements, utils, api } = dependencies;
  const getHandlers = () => dependencies.handlers;
  // ==================== 侧边栏渲染 ====================
  return {
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
        const toggleClearBtn = () => {
          if (elements.sidebarSearchClear) {
            if (elements.sidebarSearch.value) {
              elements.sidebarSearchClear.style.display = 'flex';
            } else {
              elements.sidebarSearchClear.style.display = 'none';
            }
          }
        };

        // 立即切换清除按钮的可见性
        elements.sidebarSearch.addEventListener('input', toggleClearBtn);

        elements.sidebarSearch.addEventListener('input', utils.debounce(async (e) => {
          const query = e.target.value.trim().toLowerCase();
          state.sidebar.searchQuery = query;

          if (state.sidebar.currentTab === 'event' && state.sidebar.onlyRecurring) {
            this.render();
            return;
          }

          if (query) {
            try {
              const searchData = await api.searchData(query);
              state.sidebar.dataByDate.set('__search__', searchData);
            } catch (error) {
              console.error('搜索请求失败:', error);
              state.sidebar.dataByDate.set('__search__', { todos: [], events: [], notes: [] });
            }
          } else {
            state.sidebar.dataByDate.delete('__search__');
          }

          this.render();
        }, 300));

        if (elements.sidebarSearchClear) {
          elements.sidebarSearchClear.addEventListener('click', async () => {
            elements.sidebarSearch.value = '';
            toggleClearBtn();
            state.sidebar.searchQuery = '';
            state.sidebar.dataByDate.delete('__search__');
            this.render();
          });
        }
      }

      if (elements.sidebarRecurringOnly) {
        elements.sidebarRecurringOnly.addEventListener('change', async (e) => {
          state.sidebar.onlyRecurring = !!e.target.checked;
          if (state.sidebar.onlyRecurring) {
            await this.loadFutureRecurringEvents();
          }
          this.render();
        });
      }

      // 初始加载
      this.loadInitialData();
      this.loadStats();
    },

    // 切换标签
    async switchTab(tab) {
      state.sidebar.currentTab = tab;
      if (tab !== 'todo') {
        state.sidebar.expandedRangeTabs[tab] = false;
        state.sidebar.rangeBeforeDays = 0;
        state.sidebar.rangeAfterDays = 0;
        state.sidebar.hasMoreBefore = true;
        state.sidebar.hasMoreAfter = true;
      }
      elements.sidebarTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
      });

      if (elements.eventSubfilters) {
        elements.eventSubfilters.classList.toggle('hidden', tab !== 'event');
      }

      // 如果切换到待办标签，加载所有待办事项数据
      if (tab === 'todo') {
        await this.loadAllTodos();
      }

      if (tab === 'event' && state.sidebar.onlyRecurring) {
        await this.loadFutureRecurringEvents();
      }

      this.render();
    },

    ...window.createCalendarSidebarLoader(dependencies),

    // 渲染侧边栏内容
    render() {
      const container = elements.sidebarContent;
      if (!container) return;

      container.innerHTML = '';

      if (state.sidebar.currentTab === 'event' && state.sidebar.onlyRecurring) {
        this.renderRecurringEventList(container);
        return;
      }

      // 获取所有日期并排序

        // 如果有搜索内容，优先显示搜索结果
        if (state.sidebar.searchQuery) {
          const searchData = state.sidebar.dataByDate.get('__search__');

          // 创建搜索结果分组
          const searchGroup = document.createElement('div');
          searchGroup.className = 'date-group';

          const searchHeader = document.createElement('div');
          searchHeader.className = 'date-group-header';
          searchHeader.textContent = `搜索结果: ${state.sidebar.searchQuery}`;
          searchHeader.style.color = 'var(--accent)';
          searchGroup.appendChild(searchHeader);

          if (searchData) {
            const filteredSearchData = this.filterData(searchData);

            // 渲染搜索结果
            let hasResults = false;
            if ((state.sidebar.currentTab === 'all' || state.sidebar.currentTab === 'event') && filteredSearchData.events && filteredSearchData.events.length > 0) {
              filteredSearchData.events.forEach(event => searchGroup.appendChild(this.renderEventItem(event, true)));
              hasResults = true;
            }
            if ((state.sidebar.currentTab === 'all' || state.sidebar.currentTab === 'todo') && filteredSearchData.todos && filteredSearchData.todos.length > 0) {
              filteredSearchData.todos.forEach(todo => searchGroup.appendChild(this.renderTodoItem(todo, true)));
              hasResults = true;
            }
            if ((state.sidebar.currentTab === 'all' || state.sidebar.currentTab === 'note') && filteredSearchData.notes && filteredSearchData.notes.length > 0) {
              filteredSearchData.notes.forEach(note => searchGroup.appendChild(this.renderNoteItem(note, true)));
              hasResults = true;
            }

            if (!hasResults) {
              const emptyMsg = document.createElement('div');
              emptyMsg.className = 'empty-state';
              emptyMsg.style.padding = '20px';
              emptyMsg.style.textAlign = 'center';
              emptyMsg.style.color = 'var(--gray)';
              emptyMsg.textContent = '未找到匹配结果';
              searchGroup.appendChild(emptyMsg);
            }
          } else {
            const loadingMsg = document.createElement('div');
            loadingMsg.className = 'empty-state';
            loadingMsg.style.padding = '20px';
            loadingMsg.style.textAlign = 'center';
            loadingMsg.textContent = '正在搜索...';
            searchGroup.appendChild(loadingMsg);
          }

          container.appendChild(searchGroup);
          return;
        }
      const dates = Array.from(state.sidebar.dataByDate.keys()).sort();

      // 确定渲染范围
      const selectedDateStr = utils.formatDate(state.selectedDate);
      const selectedIndex = dates.indexOf(selectedDateStr);
      // 全天事件，使用UTC时间避免时区偏差
      let renderDates = dates;
      if (selectedIndex >= 0) {
        if (state.sidebar.currentTab !== 'todo' && !state.sidebar.expandedRangeTabs[state.sidebar.currentTab]) {
          renderDates = dates.slice(selectedIndex, selectedIndex + 1);
        } else if (state.sidebar.currentTab !== 'todo') {
          const rangeBeforeDays = state.sidebar.rangeBeforeDays || 0;
          const rangeAfterDays = state.sidebar.rangeAfterDays || 0;
          renderDates = [];
          for (let offset = -rangeBeforeDays; offset <= rangeAfterDays; offset++) {
            const date = new Date(state.selectedDate);
            date.setDate(state.selectedDate.getDate() + offset);
            const dateStr = utils.formatDate(date);
            if (state.sidebar.dataByDate.has(dateStr)) {
              renderDates.push(dateStr);
            }
          }
        } else if (state.sidebar.currentTab !== 'incomplete') {
          const visibleDays = state.sidebar.visibleDays || 7;
          const startIndex = Math.max(0, selectedIndex - visibleDays);
          const endIndex = Math.min(dates.length, selectedIndex + visibleDays + 1);
          renderDates = dates.slice(startIndex, endIndex);
        }
      }

      // 对于待办标签，特殊处理：显示已完成、已逾期和进行中的待办事项，按时间排序
      if (state.sidebar.currentTab === 'todo') {
        const allTodos = [];

        // 收集所有待办事项
        dates.forEach(dateStr => {
          const dayData = state.sidebar.dataByDate.get(dateStr);
          if (dayData) {
            const filteredData = this.filterData(dayData);
            allTodos.push(...filteredData.todos);
          }
        });

        // 按状态和截止日期排序
        allTodos.sort((a, b) => {
          // 首先按完成状态排序，未完成的在前
          if (a.completed !== b.completed) {
            return a.completed ? 1 : -1;
          }

          // 然后按截止日期排序
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate - b.dueDate;
        });

        // 按状态分组
        const overdueTodos = []; // 已逾期未完成
        const ongoingTodos = []; // 未逾期未完成
        const completedTodos = []; // 已完成

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = Math.floor(today.getTime() / 1000);

        allTodos.forEach(todo => {
          if (todo.completed) {
            completedTodos.push(todo);
          } else if (todo.dueDate && todo.dueDate < todayTimestamp) {
            overdueTodos.push(todo);
          } else {
            ongoingTodos.push(todo);
          }
        });

        // 创建分组显示
        if (overdueTodos.length > 0) {
          const overdueGroup = document.createElement('div');
          overdueGroup.className = 'date-group';

          const groupHeader = document.createElement('div');
          groupHeader.className = 'date-group-header';
          groupHeader.textContent = `已逾期 (${overdueTodos.length})`;
          groupHeader.style.color = 'var(--red)';
          overdueGroup.appendChild(groupHeader);

          // 渲染已逾期的待办事项
          overdueTodos.forEach(todo => {
            overdueGroup.appendChild(this.renderTodoItem(todo));
          });

          container.appendChild(overdueGroup);
        }

        if (ongoingTodos.length > 0) {
          const ongoingGroup = document.createElement('div');
          ongoingGroup.className = 'date-group';

          const groupHeader = document.createElement('div');
          groupHeader.className = 'date-group-header';
          groupHeader.textContent = `进行中 (${ongoingTodos.length})`;
          groupHeader.style.color = 'var(--accent)';
          ongoingGroup.appendChild(groupHeader);

          // 渲染进行中的待办事项
          ongoingTodos.forEach(todo => {
            ongoingGroup.appendChild(this.renderTodoItem(todo));
          });

          container.appendChild(ongoingGroup);
        }

        if (completedTodos.length > 0) {
          const completedGroup = document.createElement('div');
          completedGroup.className = 'date-group';

          const groupHeader = document.createElement('div');
          groupHeader.className = 'date-group-header';
          groupHeader.textContent = `已完成 (${completedTodos.length})`;
          groupHeader.style.color = 'var(--green)';
          completedGroup.appendChild(groupHeader);

          // 渲染已完成的待办事项（默认折叠，只显示数量）
          const collapseBtn = document.createElement('div');
          collapseBtn.className = 'load-more-indicator';
          collapseBtn.textContent = '点击展开已完成的待办事项';
          collapseBtn.style.cursor = 'pointer';
          collapseBtn.addEventListener('click', () => {
            collapseBtn.style.display = 'none';
            completedTodos.forEach(todo => {
              completedGroup.appendChild(this.renderTodoItem(todo));
            });
          });
          completedGroup.appendChild(collapseBtn);

          container.appendChild(completedGroup);
        }

        if (allTodos.length === 0) {
          // 如果没有待办事项，显示空状态
          container.innerHTML = '<div class="empty-state">暂无待办事项</div>';
        }
      } else {
        // 其他标签按日期分组渲染
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

          if (!hasData) return;

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
      }

      // 手动加载入口（不绑定滚动触发）
      if (state.sidebar.currentTab !== 'todo') {
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
      }

      // 如果没有数据
      if (container.children.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无数据</div>';
      }
    },

    renderRecurringEventList(container) {
      const query = state.sidebar.searchQuery;
      const grouped = new Map();

      state.sidebar.futureRecurringEvents.forEach(event => {
        const key = event._originalId || event.id;
        if (!key) return;

        if (!grouped.has(key)) {
          grouped.set(key, {
            masterId: key,
            title: event.title || '未命名重复事件',
            description: event.description || '',
            color: event.color || '#2563eb',
            allDay: !!event.allDay,
            recurrence: event.recurrence,
            recurrenceEnd: event.recurrenceEnd || null,
            occurrences: []
          });
        }

        const series = grouped.get(key);
        series.occurrences.push(event);
        if (!series.recurrenceEnd && event.recurrenceEnd) {
          series.recurrenceEnd = event.recurrenceEnd;
        }
      });

      let seriesList = Array.from(grouped.values()).map(series => {
        series.occurrences.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
        series.nextOccurrence = series.occurrences[0] || null;
        series.futureCount = series.occurrences.length;
        return series;
      });

      if (query) {
        seriesList = seriesList.filter(series =>
          (series.title && series.title.toLowerCase().includes(query)) ||
          (series.description && series.description.toLowerCase().includes(query))
        );
      }

      if (seriesList.length === 0) {
        container.innerHTML = `<div class="empty-state">${query ? '未找到匹配的未来重复事件' : '暂无未来重复事件'}</div>`;
        return;
      }

      seriesList.sort((a, b) => {
        const aTime = a.nextOccurrence?.startTime || 0;
        const bTime = b.nextOccurrence?.startTime || 0;
        return aTime - bTime;
      });

      const section = document.createElement('div');
      section.className = 'date-group';

      const header = document.createElement('div');
      header.className = 'date-group-header';
      header.textContent = `未来重复系列 (${seriesList.length})`;
      header.style.color = 'var(--accent)';
      section.appendChild(header);

      seriesList.forEach(series => {
        section.appendChild(this.renderRecurringSeriesItem(series));
      });

      container.appendChild(section);
    },

    renderRecurringSeriesItem(series) {
      const item = document.createElement('div');
      item.className = 'event-item';
      item.style.borderLeftColor = series.color || '#2563eb';

      const next = series.nextOccurrence;
      const recurrence = typeof series.recurrence === 'string'
        ? (() => {
            try { return JSON.parse(series.recurrence); } catch (e) { return null; }
          })()
        : series.recurrence;

      const recurrenceLabelMap = {
        daily: '每天',
        weekly: '每周',
        monthly: '每月',
        yearly: '每年'
      };

      let nextLabel = '无后续时间';
      if (next?.startTime) {
        if (series.allDay) {
          const startInfo = utils.getAllDayDisplayDate(next.startTime, false);
          nextLabel = `下次 ${startInfo ? startInfo.shortStr : ''}`;
        } else {
          nextLabel = `下次 ${utils.formatSidebarDate(new Date(next.startTime * 1000))} ${utils.formatTime(next.startTime * 1000)}`;
        }
      }

      let untilLabel = '无限期';
      if (series.recurrenceEnd) {
        untilLabel = utils.formatSidebarDate(new Date(series.recurrenceEnd * 1000));
      }

      const recurrenceType = recurrenceLabelMap[recurrence?.type] || '重复';
      const countLabel = series.futureCount > 1 ? `未来 ${series.futureCount} 次` : '未来 1 次';

      item.innerHTML = `
        <div class="event-content" data-id="${next?.id || series.masterId}">
          <div class="event-title">${utils.escapeHtml(series.title)} <span class="recurrence-badge">重复</span></div>
          <div class="event-time">${recurrenceType} · ${countLabel}</div>
          <div class="event-time">${nextLabel} · 至 ${untilLabel}</div>
        </div>
        <div class="event-actions">
          <button class="edit-btn" data-id="${series.masterId}" title="编辑">✎</button>
          <button class="delete-btn" data-id="${next?.id || series.masterId}" title="删除">×</button>
        </div>
      `;

      const eventContent = item.querySelector('.event-content');
      eventContent.addEventListener('click', () => getHandlers().editEvent(next || { id: series.masterId }));

      const editBtn = item.querySelector('.edit-btn');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        getHandlers().editEvent(next || { id: series.masterId });
      });

      const deleteBtn = item.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        getHandlers().deleteEvent(next?.id || series.masterId);
      });

      return item;
    },

    // 过滤数据
    filterData(dayData) {
      const query = state.sidebar.searchQuery;
      const onlyRecurring = state.sidebar.currentTab === 'event' && state.sidebar.onlyRecurring;

      const filterItems = (items, options = {}) => {
        let filtered = items;

        if (options.onlyRecurring) {
          filtered = filtered.filter(item => item.isRecurringInstance || !!item.recurrence);
        }

        if (!query) return filtered;
        return filtered.filter(item =>
          (item.title && item.title.toLowerCase().includes(query)) ||
          (item.description && item.description.toLowerCase().includes(query))
        );
      };

      const filteredEvents = filterItems(dayData.events, { onlyRecurring });
      filteredEvents.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

      return {
        todos: filterItems(dayData.todos),
        events: filteredEvents,
        notes: filterItems(dayData.notes)
      };
    },

    // 渲染待办项
    renderTodoItem(todo, isSearchResult = false) {
      const item = document.createElement('div');
      item.className = 'todo-item';

      let metaHtml = '';
      if (todo.priority) {
        metaHtml += `<span class="todo-priority ${utils.getPriorityClass(todo.priority)}">${utils.getPriorityLabel(todo.priority)}</span>`;
      }

      // 处理时间显示
      let timeHtml = '';
      if (todo.allDay) {
        if (todo.dueDate) {
          const d = new Date(todo.dueDate * 1000);
          const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
          timeHtml = `<span class="todo-time">截止: ${dateStr}</span>`;
        }
      } else {
        const formatTime = (ts) => {
          const d = new Date(ts * 1000);
          return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
        };
        const formatDateWithYear = (ts) => {
          const d = new Date(ts * 1000);
          return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
        };

        if (todo.startTime && todo.dueDate) {
          timeHtml = `<span class="todo-time">${formatDateWithYear(todo.startTime)} ${formatTime(todo.startTime)} - ${formatDateWithYear(todo.dueDate)} ${formatTime(todo.dueDate)}</span>`;
        } else if (todo.dueDate) {
          timeHtml = `<span class="todo-time">截止: ${formatDateWithYear(todo.dueDate)} ${formatTime(todo.dueDate)}</span>`;
        }
      }

      let checkboxHtml = '<input type="checkbox" class="todo-checkbox" ' + (todo.completed ? 'checked' : '') + '>';
      if (state.batchSelect.enabled) {
        const key = `todo_${todo.id}`;
        const isChecked = state.batchSelect.selectedItems.has(key);
        checkboxHtml = `<input type="checkbox" class="batch-checkbox" data-id="${todo.id}" data-type="todo" ${isChecked ? 'checked' : ''}>` + checkboxHtml;
      }

      item.innerHTML = `
        ${checkboxHtml}
        <div class="todo-content" data-id="${todo.id}">
          <div class="todo-row">
            <div class="todo-title ${todo.completed ? 'completed' : ''}">${utils.escapeHtml(todo.title)}</div>
            ${timeHtml}
          </div>
          ${metaHtml ? `<div class="todo-meta">${metaHtml}</div>` : ''}
        </div>
        <div class="todo-actions">
          <button class="convert-btn" data-id="${todo.id}" title="转换为事件">📅</button>
          <button class="edit-btn" data-id="${todo.id}" title="编辑">✎</button>
          <button class="delete-btn" data-id="${todo.id}" title="删除">×</button>
        </div>
      `;

      // 事件绑定
      const checkbox = item.querySelector('.todo-checkbox');
      if (checkbox) {
        checkbox.addEventListener('change', () => getHandlers().toggleTodo(todo.id, checkbox.checked));
      }

      const contentDiv = item.querySelector('.todo-content');
      contentDiv.addEventListener('click', () => getHandlers().editTodo(todo));

      const editBtn = item.querySelector('.edit-btn');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        getHandlers().editTodo(todo);
      });

      const convertBtn = item.querySelector('.convert-btn');
      if (convertBtn) {
        convertBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          getHandlers().convertTodoToEvent(todo);
        });
      }

      const deleteBtn = item.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        getHandlers().deleteTodo(todo.id);
      });

      return item;
    },

    // 渲染事件项
    renderEventItem(event, isSearchResult = false) {
      const item = document.createElement('div');
      item.className = 'event-item';
      item.style.borderLeftColor = event.color || '#2563eb';

      let timeHtml = '';
      if (event.allDay) {
        const getFullAllDayDateStr = (ts, isEnd = false) => {
          const info = utils.getAllDayDisplayDate(ts, isEnd);
          if (!info) return '';
          const [y, m, d] = info.str.split('-');
          return `${y}/${parseInt(m)}/${parseInt(d)}`;
        };
        const startFullStr = getFullAllDayDateStr(event.startTime, false);
        const endFullStr = event.endTime ? getFullAllDayDateStr(event.endTime, true) : '';
        if (endFullStr && startFullStr !== endFullStr) {
          timeHtml = `<span class="event-all-day">${startFullStr} - ${endFullStr} 全天</span>`;
        } else {
          timeHtml = `<span class="event-all-day">${startFullStr} 全天</span>`;
        }
      } else {
        const startD = new Date(event.startTime * 1000);
        const startYear = startD.getFullYear();
        const startMonth = startD.getMonth() + 1;
        const startDay = startD.getDate();
        const startTimeStr = utils.formatTime(event.startTime * 1000);
        let timeStr = `${startYear}/${startMonth}/${startDay} ${startTimeStr}`;
        if (event.endTime) {
          const endD = new Date(event.endTime * 1000);
          const endYear = endD.getFullYear();
          const endMonth = endD.getMonth() + 1;
          const endDay = endD.getDate();
          const endTimeStr = utils.formatTime(event.endTime * 1000);
          if (startYear === endYear && startMonth === endMonth && startDay === endDay) {
            timeStr += ` - ${endTimeStr}`;
          } else {
            timeStr += ` - ${endYear}/${endMonth}/${endDay} ${endTimeStr}`;
          }
        }
        timeHtml = timeStr;
      }

      let recurrence = null;
      if (event.recurrence) {
        if (typeof event.recurrence === 'string') {
          try {
            recurrence = JSON.parse(event.recurrence);
          } catch (e) {
            recurrence = { type: event.recurrence };
          }
        } else {
          recurrence = event.recurrence;
        }
      }

      let recurrenceHtml = '';
      if (recurrence) {
        const recurrenceLabelMap = {
          daily: '按天',
          weekly: '按周',
          monthly: '按月',
          yearly: '按年',
          lunar_daily: '农历按天',
          lunar_weekly: '农历按周',
          lunar_monthly: '农历按月',
          lunar_yearly: '农历按年'
        };
        const recurrenceTypeLabel = recurrenceLabelMap[recurrence.type] || '重复';

        let recurrenceEndLabel = '持续重复';
        if (event.recurrenceEnd) {
          const endD = new Date(event.recurrenceEnd * 1000);
          recurrenceEndLabel = `至: ${endD.getFullYear()}/${endD.getMonth() + 1}/${endD.getDate()}`;
        }

        recurrenceHtml = ` · 🔄 ${recurrenceTypeLabel} · ${recurrenceEndLabel}`;
      }

      let checkboxHtml = '';
      if (state.batchSelect.enabled) {
        const eventId = event.isRecurringInstance ? event._originalId : event.id;
        const key = `event_${eventId}`;
        const isChecked = state.batchSelect.selectedItems.has(key);
        checkboxHtml = `<input type="checkbox" class="batch-checkbox" data-id="${eventId}" data-type="event" ${isChecked ? 'checked' : ''}>`;
      }

      item.innerHTML = `
        ${checkboxHtml}
        <div class="event-content" data-id="${event.isRecurringInstance ? event._originalId : event.id}">
          <div class="event-title">${utils.escapeHtml(event.title)}${(event.isRecurringInstance || recurrence) ? ' <span class="recurrence-badge">重复</span>' : ''}</div>
          <div class="event-time">${timeHtml}${recurrenceHtml}</div>
        </div>
        <div class="event-actions">
          <button class="edit-btn" data-id="${event.isRecurringInstance ? event._originalId : event.id}" title="编辑">✎</button>
          <button class="delete-btn" data-id="${event.id}" title="删除">×</button>
        </div>
      `;
      const eventContent = item.querySelector('.event-content');
      eventContent.addEventListener('click', () => getHandlers().editEvent(event));

      const editBtn = item.querySelector('.edit-btn');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        getHandlers().editEvent(event);
      });

      const deleteBtn = item.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        getHandlers().deleteEvent(event.id);
      });

      return item;
    },
    // 渲染笔记项
    renderNoteItem(note, isSearchResult = false) {
      const item = document.createElement('div');
      item.className = 'note-item';
      item.title = note.title;

      let checkboxHtml = '';
      if (state.batchSelect.enabled) {
        const key = `note_${note.id}`;
        const isChecked = state.batchSelect.selectedItems.has(key);
        checkboxHtml = `<input type="checkbox" class="batch-checkbox" data-id="${note.id}" data-type="note" ${isChecked ? 'checked' : ''}>`;
      }

      let metaHtml = '';
      if (note.updatedAt) {
        const d = new Date(note.updatedAt * 1000);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const minute = String(d.getMinutes()).padStart(2, '0');
        metaHtml = `<div class="note-time" style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">修改于: ${year}-${month}-${day} ${hour}:${minute}</div>`;
      }

      item.innerHTML = `
        ${checkboxHtml}
        <div class="note-content" style="flex: 1; min-width: 0;">
          <div class="note-title" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${utils.escapeHtml(note.title)}</div>
          ${metaHtml}
        </div>
      `;

      item.addEventListener('click', () => {
        window.open(`/app?id=${encodeURIComponent(note.id)}`, '_blank');
      });

      return item;
    },
    // 刷新数据
    async refresh() {
      const dateStr = utils.formatDate(state.selectedDate);
      await this.loadDayData(dateStr);
      if (state.sidebar.currentTab === 'event' && state.sidebar.onlyRecurring) {
        await this.loadFutureRecurringEvents();
      }
      this.render();
      this.loadStats();
    },

    // 加载统计数据
    async loadStats() {
      try {
        const data = await api.request('/api/user/stats');
        if (data) {
          const eventsEl = document.getElementById('stats-events');
          const todosEl = document.getElementById('stats-todos');

          if (eventsEl) eventsEl.textContent = `${data.day.events}·${data.month.events}·${data.year.events}·${data.total.events}`;
          if (todosEl) todosEl.textContent = `${data.day.todos}·${data.month.todos}·${data.year.todos}·${data.total.todos}`;
        }
      } catch (e) {
        console.error('加载统计失败:', e);
      }
    }
  };
};
