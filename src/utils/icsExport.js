/**
 * ICS日历文件导入导出工具
 */

const { parseRecurrenceRule, createRecurrenceRule } = require('./recurringEvents');

/**
 * 将事件转换为ICS格式
 * @param {Array} events - 事件列表
 * @returns {string} ICS格式字符串
 */
function exportToICS(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//z7Note Calendar//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:z7Note 日历',
    'X-WR-TIMEZONE:Asia/Shanghai',
    'X-WR-CALDESC:z7Note 日历导出'
  ];

  events.forEach(event => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id}@z7note`);
    lines.push(`DTSTAMP:${formatICSDate(new Date())}`);
    lines.push(`DTSTART:${formatICSDate(new Date(event.startTime * 1000))}`);
    if (event.endTime) {
      lines.push(`DTEND:${formatICSDate(new Date(event.endTime * 1000))}`);
    }
    lines.push(`SUMMARY:${escapeICS(event.title)}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
    }
    if (event.allDay) {
      lines.push('X-MICROSOFT-CDO-ALLDAYEVENT:TRUE');
    }
    if (event.color) {
      lines.push(`X-APPLE-STYLE:${event.color}`);
    }
    if (event.recurrence) {
      const recurrenceRule = createRRule(event.recurrence);
      if (recurrenceRule) {
        lines.push(`RRULE:${recurrenceRule}`);
      }
    }
    if (event.recurrenceEnd) {
      lines.push(`UNTIL=${formatICSDate(new Date(event.recurrenceEnd * 1000))}`);
    }
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

/**
 * 从ICS格式导入事件
 * @param {string} icsContent - ICS格式字符串
 * @returns {Array} 事件列表
 */
function importFromICS(icsContent) {
  const events = [];
  const lines = icsContent.split(/\r?\n/);
  let currentEvent = null;
  let inEvent = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      currentEvent = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      if (currentEvent && currentEvent.title) {
        events.push(currentEvent);
      }
      inEvent = false;
      currentEvent = null;
      continue;
    }

    if (!inEvent || !currentEvent) continue;

    const [key, ...valueParts] = line.split(':');
    const value = valueParts.join(':');

    switch (key) {
      case 'UID':
        currentEvent.id = value.replace(/@z7note$/, '') || generateId();
        break;
      case 'DTSTART':
        currentEvent.startTime = parseICSDate(value);
        break;
      case 'DTEND':
        currentEvent.endTime = parseICSDate(value);
        break;
      case 'SUMMARY':
        currentEvent.title = unescapeICS(value);
        break;
      case 'DESCRIPTION':
        currentEvent.description = unescapeICS(value);
        break;
      case 'RRULE':
        currentEvent.recurrence = parseRRule(value);
        break;
      case 'LOCATION':
        currentEvent.location = unescapeICS(value);
        break;
      case 'X-MICROSOFT-CDO-ALLDAYEVENT':
        if (value === 'TRUE') {
          currentEvent.allDay = true;
        }
        break;
    }
  }

  return events;
}

/**
 * 格式化日期为ICS格式
 * @param {Date} date - 日期对象
 * @returns {string} ICS格式日期字符串
 */
function formatICSDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * 解析ICS格式日期
 * @param {string} icsDate - ICS格式日期字符串
 * @returns {number} Unix时间戳(秒)
 */
function parseICSDate(icsDate) {
  // 移除时区信息和T
  const cleanDate = icsDate.replace(/[TZ]/g, '');

  if (cleanDate.length === 8) {
    // 只有日期,没有时间
    const year = parseInt(cleanDate.substring(0, 4));
    const month = parseInt(cleanDate.substring(4, 6)) - 1;
    const day = parseInt(cleanDate.substring(6, 8));
    const date = new Date(year, month, day);
    return Math.floor(date.getTime() / 1000);
  }

  const year = parseInt(cleanDate.substring(0, 4));
  const month = parseInt(cleanDate.substring(4, 6)) - 1;
  const day = parseInt(cleanDate.substring(6, 8));
  const hours = parseInt(cleanDate.substring(8, 10));
  const minutes = parseInt(cleanDate.substring(10, 12));
  const seconds = parseInt(cleanDate.substring(12, 14));

  const date = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
  return Math.floor(date.getTime() / 1000);
}

/**
 * 转义ICS特殊字符
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * 反转义ICS特殊字符
 * @param {string} text - 转义后的文本
 * @returns {string} 原始文本
 */
function unescapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * 创建RRULE字符串
 * @param {Object} recurrence - 重复规则对象
 * @returns {string} RRule字符串
 */
function createRRule(recurrence) {
  if (!recurrence || !recurrence.type) return null;

  const parts = ['FREQ'];

  switch (recurrence.type) {
    case 'daily':
      parts.push('DAILY');
      break;
    case 'weekly':
      parts.push('WEEKLY');
      if (recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0) {
        const dayMap = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' };
        parts.push(`BYDAY=${recurrence.daysOfWeek.map(d => dayMap[d]).join(',')}`);
      }
      break;
    case 'monthly':
      parts.push('MONTHLY');
      if (recurrence.dayOfMonth) {
        parts.push(`BYMONTHDAY=${recurrence.dayOfMonth}`);
      }
      break;
    case 'yearly':
      parts.push('YEARLY');
      if (recurrence.monthOfYear) {
        parts.push(`BYMONTH=${recurrence.monthOfYear}`);
      }
      if (recurrence.dayOfMonth) {
        parts.push(`BYMONTHDAY=${recurrence.dayOfMonth}`);
      }
      break;
    default:
      return null;
  }

  if (recurrence.interval && recurrence.interval > 1) {
    parts.push(`INTERVAL=${recurrence.interval}`);
  }

  return parts.join(';');
}

/**
 * 解析RRULE字符串
 * @param {string} rrule - RRule字符串
 * @returns {Object} 重复规则对象
 */
function parseRRule(rrule) {
  if (!rrule) return null;

  const parts = rrule.split(';');
  const recurrence = {};

  parts.forEach(part => {
    const [key, value] = part.split('=');

    switch (key) {
      case 'FREQ':
        const freqMap = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
        recurrence.type = freqMap[value];
        break;
      case 'INTERVAL':
        recurrence.interval = parseInt(value);
        break;
      case 'BYDAY':
        const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
        recurrence.daysOfWeek = value.split(',').map(d => dayMap[d]);
        break;
      case 'BYMONTHDAY':
        recurrence.dayOfMonth = parseInt(value);
        break;
      case 'BYMONTH':
        recurrence.monthOfYear = parseInt(value);
        break;
    }
  });

  return recurrence;
}

/**
 * 生成唯一ID
 * @returns {string} 唯一ID
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

module.exports = {
  exportToICS,
  importFromICS,
  formatICSDate,
  parseICSDate,
  escapeICS,
  unescapeICS
};
