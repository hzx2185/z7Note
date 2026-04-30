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
    allTodos: [], // 存储所有待办事项，用于全局操作
    isLoading: false,
    lunarCache: new Map(),

    // 新增：侧边栏状态
    sidebar: {
      currentTab: 'all', // all, event, todo, note
      searchQuery: '',
      onlyRecurring: false,
      expandedRangeTabs: {
        all: false,
        event: false
      },
      // 滚动加载相关
      loadedDays: 0, // 已加载的天数（前后各多少天）
      isLoadingMore: false,
      hasMoreBefore: true,
      hasMoreAfter: true,
      // 数据缓存 - 按日期分组
      dataByDate: new Map(), // key: 'YYYY-MM-DD', value: { todos: [], events: [], notes: [] }
      // 渲染顺序
      renderedDates: [], // 已渲染的日期列表
      futureRecurringEvents: []
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
    eventSubfilters: document.getElementById('event-subfilters'),
    sidebarRecurringOnly: document.getElementById('sidebar-recurring-only'),
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
  const utils = window.createCalendarUtils({ state, elements });

  // ==================== API 服务 ====================
  const api = window.createCalendarApi();

  // ==================== 侧边栏渲染 ====================
  const calendarDeps = { state, elements, utils, api };
  const sidebarRenderer = window.createCalendarSidebarRenderer(calendarDeps);
  calendarDeps.sidebarRenderer = sidebarRenderer;

  // ==================== 渲染函数 ====================
  const render = window.createCalendarRender(calendarDeps);
  calendarDeps.render = render;

  // ==================== 数据加载 ====================
  const dataLoader = window.createCalendarDataLoader(calendarDeps);
  calendarDeps.dataLoader = dataLoader;

  // ==================== 事件处理 ====================
  const handlers = {
    getDefaultReminderPreset(isAllDay) {
      return isAllDay ? 'same_day_9am' : '15m';
    },

    getAllowedReminderPresets(isAllDay) {
      return isAllDay
        ? new Set(['none', '15m', 'same_day_9am', 'one_day_9am'])
        : new Set(['none', '15m']);
    },

    syncReminderPresetOptions(selectId, isAllDay) {
      const select = document.getElementById(selectId);
      if (!select) return;

      const allowedPresets = handlers.getAllowedReminderPresets(isAllDay);
      Array.from(select.options).forEach(option => {
        const visible = allowedPresets.has(option.value);
        option.hidden = !visible;
        option.disabled = !visible;
      });

      if (!allowedPresets.has(select.value)) {
        handlers.setReminderPresetValue(selectId, handlers.getDefaultReminderPreset(isAllDay), false);
      }
    },

    setReminderPresetValue(selectId, preset, markTouched = false) {
      const select = document.getElementById(selectId);
      if (!select) return;
      if (select.value !== preset) {
        select.value = preset;
      }
      select.dataset.userTouched = markTouched ? '1' : '0';
    },

    maybeUpdateReminderPresetDefault(selectId, isAllDay) {
      const select = document.getElementById(selectId);
      if (!select) return;
      handlers.syncReminderPresetOptions(selectId, isAllDay);
      if (select.dataset.userTouched === '1') return;
      handlers.setReminderPresetValue(selectId, handlers.getDefaultReminderPreset(isAllDay), false);
    },

    ...window.createCalendarBatchHandlers(calendarDeps),

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
      window.scrollTo({ top: 0, behavior: 'auto' });
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

          if (yijiContent) {
            yijiContent.classList.remove('hidden');
            yijiContent.style.display = ''; // 清除可能残留的内联样式
          }
        }
      } catch (e) {
        console.error('获取农历失败:', e);
        if (yijiContent) yijiContent.classList.add('hidden');
      }
    },
    ...window.createCalendarFormHandlers(calendarDeps),

    ...window.createCalendarItemHandlers(calendarDeps),

    ...window.createCalendarImportExportHandlers(calendarDeps),

    ...window.createCalendarSubscriptionHandlers(calendarDeps)
  };

  calendarDeps.handlers = handlers;

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

    const isLoggedIn = await checkAuth();
    const loginRequiredEl = document.getElementById('login-required');

    if (!isLoggedIn) {
      if (loginRequiredEl) {
        loginRequiredEl.classList.add('show');
      }
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
    const todosFileInput = document.getElementById('todos-file-input');
    const remindersFileInput = document.getElementById('reminders-file-input');

    if (prevMonthBtn) prevMonthBtn.addEventListener('click', handlers.prevMonth);
    if (nextMonthBtn) nextMonthBtn.addEventListener('click', handlers.nextMonth);
    if (todayBtn) todayBtn.addEventListener('click', handlers.today);
    if (todoAddBtn) todoAddBtn.addEventListener('click', handlers.openTodoModal);
    if (eventAddBtn) eventAddBtn.addEventListener('click', handlers.openEventModal);
    if (newEventBtn) newEventBtn.addEventListener('click', handlers.openEventModal);
    if (subscriptionBtn) subscriptionBtn.addEventListener('click', handlers.openSubscriptionModal);
    if (exportBtn) exportBtn.addEventListener('click', handlers.showExportMenu);
    if (importBtn) importBtn.addEventListener('click', handlers.showImportMenu);
    if (icsFileInput) icsFileInput.addEventListener('change', handlers.importCalendar);
    if (todosFileInput) todosFileInput.addEventListener('change', handlers.importTodos);
    if (remindersFileInput) remindersFileInput.addEventListener('change', handlers.importReminders);

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
    const lunarCheckboxWrap = document.getElementById('lunar-checkbox-wrap');

    if (recurrenceSelect && recurrenceEndGroup) {
      recurrenceSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        utils.setRecurrenceEndVisibility(Boolean(val));

        // 仅在“每年”或“每月”重复时显示农历选项
        utils.setLunarOptionVisibility(val === 'yearly' || val === 'monthly');

        // 当选择重复类型时，设置默认的结束日期
        if (e.target.value) {
          const recurrenceEndInput = elements.eventForm.querySelector('[name="recurrenceEnd"]');
          if (!recurrenceEndInput.value) {
            recurrenceEndInput.value = utils.getDefaultRecurrenceEndDate();
          }
        }
      });
    }

      // 监听全天选项变化
      const allDaySelect = document.getElementById('allDay-select');
      if (allDaySelect) {
        allDaySelect.addEventListener('change', (e) => {
          const isAllDay = e.target.value === 'true';
          handlers.updateAllDayUI(isAllDay);
          handlers.maybeUpdateReminderPresetDefault('event-reminderPreset', isAllDay);

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

      // 监听待办全天选项变化
      const todoAllDaySelect = document.getElementById('todo-allDay-select');
      if (todoAllDaySelect) {
        todoAllDaySelect.addEventListener('change', (e) => {
          const isAllDay = e.target.value === 'true';
          handlers.updateTodoAllDayUI(isAllDay);
          handlers.maybeUpdateReminderPresetDefault('todo-reminderPreset', isAllDay);

          const dateStr = utils.formatDate(state.selectedDate);
          if (isAllDay) {
            const startDateInput = elements.todoForm.querySelector('[name="startDate"]');
            const dueDateDateInput = elements.todoForm.querySelector('[name="dueDateDate"]');
            if (!startDateInput.value) startDateInput.value = dateStr;
            if (!dueDateDateInput.value) dueDateDateInput.value = dateStr;
          } else {
            const startTimeInput = elements.todoForm.querySelector('[name="startTime"]');
            const dueDateInput = elements.todoForm.querySelector('[name="dueDate"]');
            if (!startTimeInput.value) startTimeInput.value = `${dateStr}T09:00`;
            if (!dueDateInput.value) dueDateInput.value = `${dateStr}T18:00`;
          }
        });
      }

      const eventReminderPresetSelect = document.getElementById('event-reminderPreset');
      if (eventReminderPresetSelect) {
        handlers.syncReminderPresetOptions('event-reminderPreset', true);
        eventReminderPresetSelect.addEventListener('change', () => {
          eventReminderPresetSelect.dataset.userTouched = '1';
        });
      }

      const todoReminderPresetSelect = document.getElementById('todo-reminderPreset');
      if (todoReminderPresetSelect) {
        handlers.syncReminderPresetOptions('todo-reminderPreset', true);
        todoReminderPresetSelect.addEventListener('change', () => {
          todoReminderPresetSelect.dataset.userTouched = '1';
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

    // 批量添加文本事件绑定
    const batchAddTextBtn = document.getElementById('batch-add-text-btn');
    if (batchAddTextBtn) {
      batchAddTextBtn.addEventListener('click', handlers.openBatchTextModal);
    }

    const batchTextModal = document.getElementById('batch-text-modal');
    if (batchTextModal) {
      batchTextModal.addEventListener('click', (e) => {
        if (e.target === batchTextModal) handlers.closeBatchTextModal();
      });

      const closeBtn = batchTextModal.querySelector('.batch-text-modal-close');
      if (closeBtn) closeBtn.addEventListener('click', handlers.closeBatchTextModal);

      const cancelBtn = batchTextModal.querySelector('.batch-text-modal-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', handlers.closeBatchTextModal);

      const previewBtn = document.getElementById('batch-preview-btn');
      if (previewBtn) previewBtn.addEventListener('click', handlers.previewBatchText);

      const importBtn = document.getElementById('batch-import-btn');
      if (importBtn) importBtn.addEventListener('click', () => handlers.importBatchText());
    }

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
      mobileToggle.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mv = document.getElementById('month-view');
        if (mv) {
          mv.classList.toggle('collapsed');
        }
      };
    }

  }

  // ==================== 公开API ====================
  window.CalendarAppHandlers = handlers;
  return {
    init,
    openTodoModal: () => handlers.openTodoModal(),
    openEventModal: () => handlers.openEventModal(),
    closeModals: () => handlers.closeModals()
  };
})();

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', CalendarApp.init);
