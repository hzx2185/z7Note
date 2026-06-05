window.createCalendarUtils = function createCalendarUtils({ state, elements }) {
  // ==================== 工具函数 ====================
  return {
    // 批量解析输入
    parseBatchInput(text) {
      const lines = text.split('\n').filter(line => line.trim());
      const results = [];
      const now = new Date();
      const currentYear = now.getFullYear();

      // Regex for Date:
      // 1. YYYY-MM-DD or YYYY/MM/DD or YYYY年MM月DD日
      // 2. MM-DD or MM/DD or MM月DD日 (assume current year)
      // 3. M.D (assume current year)
      // 4. "Today", "Tomorrow" (in Chinese: 今天, 明天, 后天)

      const dateRegex = /(\d{4}[-\/年]\d{1,2}[-\/月]\d{1,2}日?)|(\d{1,2}[-\/月]\d{1,2}日?)|(\d{1,2}\.\d{1,2})|(今天|明天|后天)/;

      lines.forEach(line => {
        const match = line.match(dateRegex);
        if (match) {
          let dateStr = match[0];
          let date = null;

          if (dateStr === '今天') {
            date = new Date();
          } else if (dateStr === '明天') {
            date = new Date();
            date.setDate(date.getDate() + 1);
          } else if (dateStr === '后天') {
            date = new Date();
            date.setDate(date.getDate() + 2);
          } else if (dateStr.includes('.')) {
            // M.D
            const parts = dateStr.split('.');
            date = new Date(currentYear, parseInt(parts[0]) - 1, parseInt(parts[1]));
          } else {
            // Normalize separators
            const normalized = dateStr.replace(/[年\/]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, '');
            const parts = normalized.split('-');

            if (parts.length === 3) {
              // YYYY-MM-DD
              date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            } else if (parts.length === 2) {
              // MM-DD
              date = new Date(currentYear, parseInt(parts[0]) - 1, parseInt(parts[1]));
            }
          }

          // Title is the rest of the line
          let title = line.replace(dateStr, '').trim();
          // Remove common separators like :, -, space
          title = title.replace(/^[:：\-\s]+|[:：\-\s]+$/g, '');

          if (title && !isNaN(date.getTime())) {
            results.push({
              title: title,
              date: this.formatDate(date), // YYYY-MM-DD
              original: line
            });
          }
        }
      });
      return results;
    },

    formatDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },

    getLocalTimeZone() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
      } catch (e) {
        return 'Asia/Shanghai';
      }
    },

    // 健壮的日期转换：针对全天事件进行特殊处理 (使用 UTC 提取日期)
    getAllDayDisplayDate(ts, isEnd = false) {
      if (!ts || ts <= 0) return null;

      // 注意：后端对于全天事件统一存为 UTC 00:00:00
      // 这里的 ts 是秒级时间戳
      let d = new Date(ts * 1000);

      // 检查日期是否有效
      if (isNaN(d.getTime())) return null;

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

    parseDateInputToUtcTs(dateStr) {
      if (!dateStr) return null;
      const [year, month, day] = dateStr.split('-').map(Number);
      if (!year || !month || !day) return null;
      return Math.floor(Date.UTC(year, month - 1, day) / 1000);
    },

    formatUtcTsToDateInput(ts) {
      if (!ts && ts !== 0) return '';
      const d = new Date(ts * 1000);
      if (isNaN(d.getTime())) return '';
      return this.formatUTCDate(d);
    },

    setLunarOptionVisibility(visible) {
      const lunarCheckboxWrap = document.getElementById('lunar-checkbox-wrap');
      const lunarCheckbox = document.getElementById('isLunar-checkbox');
      if (!lunarCheckboxWrap) return;

      lunarCheckboxWrap.classList.toggle('hidden', !visible);
      if (!visible && lunarCheckbox) {
        lunarCheckbox.checked = false;
      }
    },

    setRecurrenceEndVisibility(visible) {
      const recurrenceEndGroup = document.getElementById('recurrence-end-group');
      if (!recurrenceEndGroup) return;
      recurrenceEndGroup.classList.toggle('hidden', !visible);
    },

    getDefaultRecurrenceEndDate() {
      const form = elements.eventForm;
      const allDayInput = form?.querySelector('[name="allDay"]');
      const startDateInput = form?.querySelector('[name="startDate"]');
      const endDateInput = form?.querySelector('[name="endDate"]');
      const startTimeInput = form?.querySelector('[name="startTime"]');
      const endTimeInput = form?.querySelector('[name="endTime"]');

      let baseDate = null;
      const isAllDay = allDayInput?.value === 'true';

      if (isAllDay) {
        const baseDateStr = endDateInput?.value || startDateInput?.value;
        if (baseDateStr) {
          const [year, month, day] = baseDateStr.split('-').map(Number);
          if (year && month && day) {
            baseDate = new Date(Date.UTC(year, month - 1, day));
          }
        }
      } else {
        const baseDateStr = endTimeInput?.value || startTimeInput?.value;
        if (baseDateStr) {
          const parsed = new Date(baseDateStr);
          if (!Number.isNaN(parsed.getTime())) {
            baseDate = new Date(Date.UTC(
              parsed.getFullYear(),
              parsed.getMonth(),
              parsed.getDate()
            ));
          }
        }
      }

      if (!baseDate) {
        baseDate = new Date(state.selectedDate);
        baseDate = new Date(Date.UTC(
          baseDate.getFullYear(),
          baseDate.getMonth(),
          baseDate.getDate()
        ));
      }

      baseDate.setUTCFullYear(baseDate.getUTCFullYear() + 1);
      return this.formatUTCDate(baseDate);
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
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      return `${year}/${month}/${day}`;
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
};
