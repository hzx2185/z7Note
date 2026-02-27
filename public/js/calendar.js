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
      ,
      // 批量选择状态
      batchSelect: {
        enabled: false,
        selectedItems: new Set() // 存储选中的项目ID
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

    // 健壮的日期转换：针对全天事件进行特殊处理 (使用 UTC 提取日期)
    getAllDayDisplayDate(ts, isEnd = false) {
      if (!ts) return null;
      
      // 注意：后端对于全天事件统一存为 UTC 00:00:00
      // 这里的 ts 是秒级时间戳
      let d = new Date(ts * 1000);
      
      // 如果是结束时间，我们需要回退一秒 (iCal 的排他性 DTEND)
      if (isEnd) {
          d.setUTCSeconds(d.getUTCSeconds() - 1);
      }
      
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      
      return { 
          str: `${year}-${month}-${day}`, 
          shortStr: `${parseInt(month)}/${parseInt(day)}` 
      };
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
    },

    // 格式化为本地时间字符串 (datetime-local 专用)
    toLocalISO(ts) {
      if (!ts) return '';
      const d = new Date(ts * 1000);
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().slice(0, 16);
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
        console.log('[API] 获取单天数据:', dateStr);
        const response = await fetch(`/api/events/calendar/day/${dateStr}?t=${Date.now()}`, {
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

      // 搜索数据
      async searchData(query) {
        try {
          const response = await fetch(`/api/events/search?q=${encodeURIComponent(query)}`, {
            credentials: 'include'
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return await response.json();
        } catch (error) {
          console.error('搜索失败:', error);
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
        const response = await fetch(`/api/todos?startDate=${startDate}&endDate=${endDate}&t=${Date.now()}`, {
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
        const response = await fetch(`/api/events?startDate=${startDate}&endDate=${endDate}&t=${Date.now()}`, {
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
        elements.sidebarSearch.addEventListener('input', utils.debounce(async (e) => {
          state.sidebar.searchQuery = e.target.value.toLowerCase();
          
            
            // 如果有搜索内容，使用搜索API
            if (state.sidebar.searchQuery) {
              const searchData = await api.searchData(state.sidebar.searchQuery);
              // 将搜索结果存储到一个特殊的日期
              state.sidebar.dataByDate.set('__search__', searchData);
            }
          
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
      this.loadStats();
    },

    // 切换标签
    async switchTab(tab) {
      state.sidebar.currentTab = tab;
      elements.sidebarTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
      });
      
      // 如果切换到待办标签，加载所有待办事项数据
      if (tab === 'todo') {
        await this.loadAllTodos();
      }
      
      this.render();
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
          console.log('[sidebar] 加载所有待办事项:', allTodos.length);
          
          // 更新待办事项数量
          const incompleteCountEl = document.getElementById('incomplete-count');
          if (incompleteCountEl) {
            const incompleteTodos = allTodos.filter(t => !t.completed);
            incompleteCountEl.textContent = incompleteTodos.length;
          }
          
          // 清空现有的待办数据
          state.sidebar.dataByDate.clear();
          
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

      // 加载所有数据（用于搜索）
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
        
        // 如果有搜索内容，优先显示搜索结果
        if (state.sidebar.searchQuery) {
          const searchData = state.sidebar.dataByDate.get('__search__');
          if (searchData) {
            const filteredData = this.filterData(searchData);
            
            // 创建搜索结果分组
            const searchGroup = document.createElement('div');
            searchGroup.className = 'date-group';
            
            const searchHeader = document.createElement('div');
            searchHeader.className = 'date-group-header';
            searchHeader.textContent = `搜索结果: ${state.sidebar.searchQuery}`;
            searchHeader.style.color = 'var(--accent)';
            searchGroup.appendChild(searchHeader);
            
            // 渲染搜索结果
            filteredData.events.forEach(event => searchGroup.appendChild(this.renderEventItem(event)));
            filteredData.todos.forEach(todo => searchGroup.appendChild(this.renderTodoItem(todo)));
            filteredData.notes.forEach(note => searchGroup.appendChild(this.renderNoteItem(note)));
            
            if (filteredData.events.length === 0 && filteredData.todos.length === 0 && filteredData.notes.length === 0) {
              const emptyMsg = document.createElement('div');
              emptyMsg.className = 'empty-state';
              emptyMsg.textContent = '未找到匹配结果';
              searchGroup.appendChild(emptyMsg);
            }
            
            container.appendChild(searchGroup);
            return;
          }
        }
      const dates = Array.from(state.sidebar.dataByDate.keys()).sort();
      
      // 确定渲染范围
      const selectedDateStr = utils.formatDate(state.selectedDate);
      const selectedIndex = dates.indexOf(selectedDateStr);
      // 全天事件，使用UTC时间避免时区偏差
      let renderDates = dates;
      if (selectedIndex >= 0 && state.sidebar.currentTab !== 'incomplete') {
        // 渲染选中日期前后各loadedDays天（除了未完成标签）
        const startIndex = Math.max(0, selectedIndex - state.sidebar.loadedDays);
        const endIndex = Math.min(dates.length, selectedIndex + state.sidebar.loadedDays + 1);
        renderDates = dates.slice(startIndex, endIndex);
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

      // 显示加载更多提示（待办标签除外）
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

      let checkboxHtml = '<input type="checkbox" class="todo-checkbox" ' + (todo.completed ? 'checked' : '') + '>';
      if (state.batchSelect.enabled) {
        const key = `todo_${todo.id}`;
        const isChecked = state.batchSelect.selectedItems.has(key);
        checkboxHtml = `<input type="checkbox" class="batch-checkbox" data-id="${todo.id}" data-type="todo" ${isChecked ? 'checked' : ''} style="width: 14px; height: 14px; margin-right: 6px;">` + checkboxHtml;
      }

      item.innerHTML = `
        ${checkboxHtml}
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
      if (checkbox) {
        checkbox.addEventListener('change', () => handlers.toggleTodo(todo.id, checkbox.checked));
      }

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
        const startInfo = utils.getAllDayDisplayDate(event.startTime, false);
        const endInfo = utils.getAllDayDisplayDate(event.endTime, true);
        
        if (startInfo && endInfo && startInfo.str !== endInfo.str) {
          timeHtml = `<span class="event-all-day">${startInfo.shortStr} - ${endInfo.shortStr} 全天</span>`;
        } else {
          timeHtml = `<span class="event-all-day">${startInfo ? startInfo.shortStr : ''} 全天</span>`;
        }
      } else {
        timeHtml = utils.formatTime(event.startTime * 1000);
        if (event.endTime) {
          timeHtml += ` - ${utils.formatTime(event.endTime * 1000)}`;
        }
      }

      let checkboxHtml = '';
      if (state.batchSelect.enabled) {
        const eventId = event.isRecurringInstance ? event._originalId : event.id;
        const key = `event_${eventId}`;
        const isChecked = state.batchSelect.selectedItems.has(key);
        checkboxHtml = `<input type="checkbox" class="batch-checkbox" data-id="${eventId}" data-type="event" ${isChecked ? 'checked' : ''} style="width: 14px; height: 14px; margin-right: 6px;">`;
      }

      item.innerHTML = `
        ${checkboxHtml}
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

      let checkboxHtml = '';
      if (state.batchSelect.enabled) {
        const key = `note_${note.id}`;
        const isChecked = state.batchSelect.selectedItems.has(key);
        checkboxHtml = `<input type="checkbox" class="batch-checkbox" data-id="${note.id}" data-type="note" ${isChecked ? 'checked' : ''} style="width: 14px; height: 14px; margin-right: 6px;">`;
      }

      item.innerHTML = `
        ${checkboxHtml}
        <div class="note-title">${utils.escapeHtml(note.title)}</div>
      `;

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
      this.loadStats();
    },

    // 加载统计数据
    async loadStats() {
      try {
        const data = await api.request('/api/user/stats');
        if (data) {
          const eventsEl = document.getElementById('stats-events');
          const todosEl = document.getElementById('stats-todos');
          const notesEl = document.getElementById('stats-notes');
          
          if (eventsEl) eventsEl.textContent = `${data.month.events}·${data.year.events}·${data.total.events}`;
          if (todosEl) todosEl.textContent = `${data.month.todos}·${data.year.todos}·${data.total.todos}`;
          if (notesEl) notesEl.textContent = `${data.month.notes}·${data.year.notes}·${data.total.notes}`;
        }
      } catch (e) {
        console.error('加载统计失败:', e);
      }
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
      
      // 同步跳转输入框
      const jumpYear = document.getElementById('jump-year');
      const jumpMonth = document.getElementById('jump-month');
      if (jumpYear) jumpYear.value = year;
      if (jumpMonth) jumpMonth.value = month + 1;

      if (elements.monthViewGrid) {
        elements.monthViewGrid.innerHTML = '';
      }

      this.renderFullMonthView(year, month);
      dataLoader.loadMonthData(year, month);
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
    // 获取并更新天气信息
    async updateWeather() {
      const weatherEl = document.getElementById('sidebar-weather');
      if (!weatherEl) return;

      try {
        // 使用 wttr.in 获取天气 (支持自动定位，返回简洁文本)
        // format=%c+%t: 符号 + 温度
        const response = await fetch('https://wttr.in/?format=%c%t');
        if (response.ok) {
          const text = await response.text();
          weatherEl.textContent = text.trim();
        }
      } catch (e) {
        console.error('获取天气失败:', e);
        weatherEl.textContent = '';
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
      
      if (!confirm(`确定要删除选中的 ${state.batchSelect.selectedItems.size} 个项目吗？`)) {
        return;
      }
      
      try {
        const eventIds = [];
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
      if (!confirm('确定要清空所有日历事件吗？此操作不可恢复！')) {
        return;
      }
      if (!confirm('请再次确认：清空全部日历事件？')) {
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
      if (!confirm('将对所有日历事件进行规范化修复（修复时间戳格式、清理非法字符等），是否继续？')) {
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
      if (!confirm('将自动查找并删除标题和时间完全相同的重复事件，是否继续？')) {
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
      
      // 更新农历和宜忌
      handlers.updateLunarInfo(dateStr);

      render.calendar();
      sidebarRenderer.refresh();
      
      // 滚动侧边栏内容到顶部
      if (elements.sidebarContent) {
        elements.sidebarContent.scrollTop = 0;
      }
    },

    async updateLunarInfo(dateStr) {
      const lunarEl = document.getElementById('sidebar-lunar');
      const yijiContent = document.getElementById('yiji-content');
      const yiEl = document.getElementById('yiji-yi');
      const jiEl = document.getElementById('yiji-ji');
      
      try {
        const data = await api.request(`/api/lunar/${dateStr}`);
        if (data && lunarEl) {
          lunarEl.textContent = data.fullText;
          if (yiEl) yiEl.textContent = data.yi.join(' ');
          if (jiEl) jiEl.textContent = data.ji.join(' ');
          if (yijiContent) yijiContent.style.display = 'block';
        }
      } catch (e) {
        console.error('获取农历失败:', e);
        if (yijiContent) yijiContent.style.display = 'none';
      }
    },

    openTodoModal() {
      if (!elements.todoForm.dataset.todoId) {
        // 新建模式：明确初始化所有字段
        elements.todoForm.reset();
        
        const dueDateInput = elements.todoForm.querySelector('[name="dueDate"]');
        dueDateInput.value = utils.formatDate(state.selectedDate);
        
        // 明确初始化checkbox状态
        const reminderEmailInput = elements.todoForm.querySelector('[name="reminderEmail"]');
        const reminderBrowserInput = elements.todoForm.querySelector('[name="reminderBrowser"]');
        if (reminderEmailInput) reminderEmailInput.checked = true;  // 默认勾选邮件提醒
        if (reminderBrowserInput) reminderBrowserInput.checked = true;  // 默认勾选浏览器提醒
        
        const modalTitle = elements.todoModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加待办事项';
      }
      elements.todoModal.classList.add('show');
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

        const dateStr = utils.formatDate(state.selectedDate);
        startTimeInput.value = `${dateStr}T09:00`;
        endTimeInput.value = `${dateStr}T18:00`;
        allDayInput.value = 'true';
        startDateInput.value = dateStr;
        endDateInput.value = dateStr;
        
        // 明确初始化checkbox状态
        const reminderEmailInput = elements.eventForm.querySelector('[name="reminderEmail"]');
        const reminderBrowserInput = elements.eventForm.querySelector('[name="reminderBrowser"]');
        const reminderCaldavInput = elements.eventForm.querySelector('[name="reminderCaldav"]');
        if (reminderEmailInput) reminderEmailInput.checked = true;  // 默认勾选邮件提醒
        if (reminderBrowserInput) reminderBrowserInput.checked = true;  // 默认勾选浏览器提醒
        if (reminderCaldavInput) reminderCaldavInput.checked = true;  // 默认勾选日历应用提醒
        
        const modalTitle = elements.eventModal.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = '添加事件';
        
        // 初始化显示状态：默认显示全天 UI
        handlers.updateAllDayUI(true);
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
        datetimeRow.style.display = 'none';
        dateRow.style.display = 'flex';
        startTimeInput.removeAttribute('required');
        startDateInput.setAttribute('required', '');
      } else {
        // 非全天事件:显示时间选择器,隐藏日期选择器
        datetimeRow.style.display = 'flex';
        dateRow.style.display = 'none';
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

      // 显式处理复选框，因为未勾选的复选框不会出现在 FormData 中
      data.reminderEmail = elements.todoForm.querySelector('[name="reminderEmail"]')?.checked ? 1 : 0;
      data.reminderBrowser = elements.todoForm.querySelector('[name="reminderBrowser"]')?.checked ? 1 : 0;

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
        
        // 对齐事件保存逻辑：强制刷新缓存
        state.lunarCache.clear();
        
        // 更新未完成待办事项数量
        await sidebarRenderer.updateIncompleteCount();

        // 强制重新加载所有待办数据，确保侧边栏缓存中的 todo 对象是最新的
        await sidebarRenderer.loadAllTodos();

        this.closeModals();

        // 强制重新从服务器同步侧栏当天数据和月视图
        await sidebarRenderer.refresh();
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
        alert('保存失败，请重试');
      }
    },

    async toggleTodo(id, completed) {
      try {
        await api.toggleTodo(id, completed);
        
        // 更新未完成待办事项数量
        await sidebarRenderer.updateIncompleteCount();
        
        // 如果当前在待办标签页，重新加载待办数据
        if (state.sidebar.currentTab === 'todo') {
          await sidebarRenderer.loadAllTodos();
        }
        
        sidebarRenderer.refresh();
      } catch (error) {
        console.error('切换待办状态失败:', error);
      }
    },

    async deleteTodo(id) {
      if (!confirm('确定要删除这个待办事项吗？')) return;

      try {
        await api.deleteTodo(id);
        
        // 更新未完成待办事项数量
        await sidebarRenderer.updateIncompleteCount();
        
        // 如果当前在待办标签页，重新加载待办数据
        if (state.sidebar.currentTab === 'todo') {
          await sidebarRenderer.loadAllTodos();
        }
        
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

      // 显式回填待办提醒勾选状态
      const reminderEmailInput = elements.todoForm.querySelector('[name="reminderEmail"]');
      const reminderBrowserInput = elements.todoForm.querySelector('[name="reminderBrowser"]');
      
      if (reminderEmailInput) reminderEmailInput.checked = todo.reminderEmail === 1;
      if (reminderBrowserInput) reminderBrowserInput.checked = todo.reminderBrowser === 1;

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
            <button type="button" class="sync-sub-btn" data-sub-id="${sub.id}" style="padding: 4px 8px; font-size: 11px; background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer;">同步</button>
            <button type="button" class="edit-sub-btn" data-sub-id="${sub.id}" style="padding: 4px 8px; font-size: 11px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">编辑</button>
            <button type="button" class="delete-sub-btn" data-sub-id="${sub.id}" style="padding: 4px 8px; font-size: 11px; background: #fee2e2; color: #dc2626; border: none; border-radius: 4px; cursor: pointer;">删除</button>
          </div>
        </div>
      `).join('');

        // 绑定事件
        container.querySelectorAll('.sync-sub-btn').forEach(btn => {
          btn.addEventListener('click', () => this.syncSubscription(btn.dataset.subId));
        });
        container.querySelectorAll('.edit-sub-btn').forEach(btn => {
          btn.addEventListener('click', () => this.editSubscription(btn.dataset.subId));
        });
        container.querySelectorAll('.delete-sub-btn').forEach(btn => {
          btn.addEventListener('click', () => this.deleteSubscription(btn.dataset.subId));
        });
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
    
    // 初始化天气
    const weatherEl = document.getElementById('sidebar-weather');
    if (weatherEl) {
      handlers.updateWeather();
      weatherEl.addEventListener('click', () => {
        weatherEl.textContent = '...';
        handlers.updateWeather();
      });
    }
    
    // 绑定跳转按钮
    const jumpBtn = document.getElementById('jump-btn');
    const jumpYear = document.getElementById('jump-year');
    const jumpMonth = document.getElementById('jump-month');

    if (jumpYear) jumpYear.value = state.currentDate.getFullYear();
    if (jumpMonth) jumpMonth.value = state.currentDate.getMonth() + 1;

    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const y = parseInt(jumpYear.value);
        const m = parseInt(jumpMonth.value);
        if (y > 1900 && y < 2100 && m >= 1 && m <= 12) {
          state.currentDate.setFullYear(y);
          state.currentDate.setMonth(m - 1);
          render.calendar();
          sidebarRenderer.refresh();
        }
      });
    }
    
    // 初始化未完成待办事项数量
    sidebarRenderer.updateIncompleteCount();

    // 监听重复选项变化
    const recurrenceSelect = document.getElementById('recurrence-select');
    const recurrenceEndGroup = document.getElementById('recurrence-end-group');
    if (recurrenceSelect && recurrenceEndGroup) {
      recurrenceSelect.addEventListener('change', (e) => {
        recurrenceEndGroup.style.display = e.target.value ? 'block' : 'none';
      });
    }

      // 监听全天选项变化
      const allDaySelect = document.getElementById('allDay-select');
      if (allDaySelect) {
        allDaySelect.addEventListener('change', (e) => {
          const isAllDay = e.target.value === 'true';
          handlers.updateAllDayUI(isAllDay);
          
          // 当切换到全天事件时，确保日期框的值被正确设置
          if (isAllDay) {
            const startDateInput = elements.eventForm.querySelector('[name="startDate"]');
            const endDateInput = elements.eventForm.querySelector('[name="endDate"]');
            const dateStr = utils.formatDate(state.selectedDate);
            
            // 如果日期框为空，设置为当前选中的日期
            if (!startDateInput.value) {
              startDateInput.value = dateStr;
            }
            if (!endDateInput.value) {
              endDateInput.value = dateStr;
            }
          }
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

      // 批量选择相关事件监听
      const batchSelectBtn = document.getElementById('batch-select-btn');
      if (batchSelectBtn) {
        batchSelectBtn.addEventListener('click', () => handlers.toggleBatchSelect());
      }
      
      const selectAllCheckbox = document.getElementById('select-all-checkbox');
      if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => handlers.toggleSelectAll(e.target.checked));
      }
      
      const batchDeleteBtn = document.getElementById('batch-delete-btn');
      if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', () => handlers.batchDelete());
      }

      const batchFormatBtn = document.getElementById('batch-format-btn');
      if (batchFormatBtn) {
        batchFormatBtn.addEventListener('click', () => handlers.formatData());
      }

      const batchCleanupBtn = document.getElementById('batch-cleanup-btn');
      if (batchCleanupBtn) {
        batchCleanupBtn.addEventListener('click', () => handlers.cleanupDuplicates());
      }

      const batchClearBtn = document.getElementById('batch-clear-btn');
      if (batchClearBtn) {
        batchClearBtn.addEventListener('click', () => handlers.clearAllEvents());
      }
      
      const cancelSelectBtn = document.getElementById('cancel-select-btn');
      if (cancelSelectBtn) {
        cancelSelectBtn.addEventListener('click', () => handlers.toggleBatchSelect());
      }
      
      // 使用事件委托处理批量复选框点击
      const sidebarContent = document.getElementById('sidebar-content');
      if (sidebarContent) {
        sidebarContent.addEventListener('change', (e) => {
          if (e.target.classList.contains('batch-checkbox')) {
            const id = e.target.dataset.id;
            const type = e.target.dataset.type;
            handlers.toggleItemSelection(id, type);
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
    const initialDateStr = utils.formatDate(state.selectedDate);
    elements.sidebarDate.textContent = utils.formatSidebarDate(state.selectedDate);
    handlers.updateLunarInfo(initialDateStr);

    // 手机端默认折叠日期框
    if (window.innerWidth <= 768) {
      const monthView = document.getElementById('month-view');
      if (monthView) monthView.classList.add('collapsed');
    }

    const mobileToggle = document.getElementById('mobile-calendar-toggle');
    if (mobileToggle) {
      console.log('[CalendarApp] 绑定手机端折叠切换按钮');
      mobileToggle.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mv = document.getElementById('month-view');
        if (mv) {
          mv.classList.toggle('collapsed');
          console.log('[CalendarApp] 切换折叠状态:', mv.classList.contains('collapsed'));
        }
      };
    }

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
