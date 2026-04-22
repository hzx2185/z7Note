/**
 * ICS日历文件导入导出工具（增强版）
 * 支持Google Calendar、Outlook等格式，以及提醒功能
 */

const { parseRecurrenceRule, createRecurrenceRule } = require('./recurringEvents');
const {
  getReminderTrigger,
  inferReminderPreset,
  formatICSDate,
  formatICSDateTime,
  parseICSDate,
  escapeICS,
  unescapeICS
} = require('./icalShared');

function mapGoogleColor(color) {
  const reverseMap = {
    '#4285f4': '#2563eb',
    '#34a853': '#10b981',
    '#fbbc04': '#f59e0b',
    '#ea4335': '#ef4444',
    '#a142f4': '#8b5cf6',
    '#e91e63': '#ec4899',
    '#673ab7': '#6366f1'
  };
  return reverseMap[color] || color;
}

/**
 * 将事件转换为ICS格式（增强版）
 * @param {Array} events - 事件列表
 * @param {Object} options - 导出选项
 * @returns {string} ICS格式字符串
 */
function exportToICS(events, options = {}) {
  const {
    includeReminders = true,
    targetApp = 'standard', // 'standard', 'google', 'outlook'
    timezone = 'Asia/Shanghai'
  } = options;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//z7Note Calendar//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-TIMEZONE:${timezone}`,
    'X-WR-CALNAME:z7Note 日历',
    'X-WR-CALDESC:z7Note 日历导出'
  ];

  events.forEach(event => {
    // 使用事件自带的时区，如果没有则使用默认时区
    const eventTimezone = event.timezone || timezone;
    
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id}@z7note`);
    lines.push(`DTSTAMP:${formatICSDateTime(new Date(), {utc: true})}`); // DTSTAMP should be UTC
    lines.push(`DTSTART;${event.allDay ? 'VALUE=DATE:' : `TZID=${eventTimezone}:`}${formatICSDateTime(new Date(event.startTime * 1000), {allDay: event.allDay, timezone: eventTimezone})}`);
    if (event.endTime) {
      lines.push(`DTEND;${event.allDay ? 'VALUE=DATE:' : `TZID=${eventTimezone}:`}${formatICSDateTime(new Date(event.endTime * 1000), {allDay: event.allDay, timezone: eventTimezone})}`);
    }
    lines.push(`SUMMARY:${escapeICS(event.title)}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
    }

    // 全天事件
    if (event.allDay) {
      lines.push('X-MICROSOFT-CDO-ALLDAYEVENT:TRUE');
    }

    // 颜色标记
    if (event.color) {
      lines.push(`X-APPLE-STYLE:${event.color}`);
      if (targetApp === 'google') {
        // Google Calendar 颜色映射
        const googleColor = mapColorToGoogle(event.color);
        if (googleColor) {
          lines.push(`X-GOOGLE-CALENDAR-CONTENT-COLOR:${googleColor}`);
        }
      }
    }

    // 重复规则
    if (event.recurrence) {
      const recurrenceRule = createRRule(event.recurrence);
      if (recurrenceRule) {
        lines.push(`RRULE:${recurrenceRule}`);
      }
    }

    // 重复结束日期
    if (event.recurrenceEnd) {
      lines.push(`UNTIL=${formatICSDate(new Date(event.recurrenceEnd * 1000))}`);
    }

    // 提醒功能（VALARM）
    if (includeReminders && targetApp !== 'outlook') {
      // Outlook 对 VALARM 支持有限
      const reminderTrigger = getReminderTrigger(event);
      if (reminderTrigger && (event.reminderEmail || event.reminderBrowser || event.reminderCaldav)) {
        lines.push('BEGIN:VALARM');
        lines.push(`TRIGGER${reminderTrigger}`);
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:${escapeICS(event.title)}`);
        lines.push('END:VALARM');

        // 如果启用了邮件提醒
        if (event.reminderEmail) {
          lines.push('BEGIN:VALARM');
          lines.push(`TRIGGER${reminderTrigger}`);
          lines.push('ACTION:EMAIL');
          lines.push(`SUMMARY:Reminder: ${escapeICS(event.title)}`);
          lines.push(`DESCRIPTION:${escapeICS(event.description || event.title)}`);
          lines.push('END:VALARM');
        }
      }
    }

    // Google Calendar 特定属性
    if (targetApp === 'google') {
      if (event.location) {
        lines.push(`LOCATION:${escapeICS(event.location)}`);
      }
      if (event.reminderBrowser) {
        lines.push('X-GOOGLE-REMINDER:DEFAULT');
      }
    }

    // Outlook 特定属性
    if (targetApp === 'outlook') {
      if (event.location) {
        lines.push(`LOCATION:${escapeICS(event.location)}`);
      }
      lines.push('CLASS:PUBLIC');
      if (event.reminderBrowser) {
        lines.push('X-MICROSOFT-CDO-BUSYSTATUS:BUSY');
      }
    }

    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

/**
 * 从ICS格式导入事件（增强版）
 * @param {string} icsContent - ICS格式字符串
 * @param {Object} options - 导入选项
 * @returns {Array} 事件列表
 */
function importFromICS(icsContent, options = {}) {
  let {
    importReminders = true,
    sourceApp = 'auto' // 'auto', 'google', 'outlook', 'standard'
  } = options;

  const events = [];
  const lines = icsContent.split(/\r?\n/);
  let currentEvent = null;
  let inEvent = false;
  let inAlarm = false;
  let currentAlarm = null;

  // 自动检测来源
  if (sourceApp === 'auto') {
    sourceApp = detectICSSource(icsContent);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      currentEvent = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      if (currentEvent && currentEvent.title) {
        // 处理提醒信息
        if (importReminders && currentEvent.alarms && currentEvent.alarms.length > 0) {
          currentEvent.reminderBrowser = currentEvent.alarms.some(alarm => alarm.action !== 'EMAIL');
          currentEvent.reminderEmail = currentEvent.alarms.some(alarm => alarm.action === 'EMAIL');
          currentEvent.reminderCaldav = currentEvent.reminderBrowser ? 1 : 0;
          const displayAlarm = currentEvent.alarms.find(alarm => alarm.action !== 'EMAIL') || currentEvent.alarms[0];
          currentEvent.reminderPreset = inferReminderPreset(currentEvent, displayAlarm?.trigger);
        } else if (importReminders) {
          currentEvent.reminderBrowser = false;
          currentEvent.reminderEmail = false;
          currentEvent.reminderCaldav = 0;
          currentEvent.reminderPreset = 'none';
        }

        // 根据来源应用调整属性
        if (sourceApp === 'google') {
          currentEvent = adjustForGoogle(currentEvent);
        } else if (sourceApp === 'outlook') {
          currentEvent = adjustForOutlook(currentEvent);
        }

        events.push(currentEvent);
      }
      inEvent = false;
      currentEvent = null;
      currentAlarm = null;
      continue;
    }

    if (line === 'BEGIN:VALARM') {
      inAlarm = true;
      currentAlarm = {};
      continue;
    }

    if (line === 'END:VALARM') {
      inAlarm = false;
      if (currentEvent && currentAlarm) {
        if (!currentEvent.alarms) currentEvent.alarms = [];
        currentEvent.alarms.push(currentAlarm);
      }
      currentAlarm = null;
      continue;
    }

    if (!inEvent || !currentEvent) continue;

    const [key, ...valueParts] = line.split(':');
    const value = valueParts.join(':');
    
    // 提取主键名（去掉参数部分）
    const mainKey = key.split(';')[0];

    // 处理 VALARM 内容
    if (inAlarm) {
      switch (mainKey) {
        case 'TRIGGER':
          currentAlarm.trigger = key === 'TRIGGER' ? value : `${key.slice('TRIGGER'.length)}:${value}`;
          break;
        case 'ACTION':
          currentAlarm.action = value;
          break;
        case 'DESCRIPTION':
          currentAlarm.description = unescapeICS(value);
          break;
        case 'SUMMARY':
          currentAlarm.summary = unescapeICS(value);
          break;
      }
      continue;
    }

    // 处理 VEVENT 内容
    switch (mainKey) {
      case 'UID':
        currentEvent.id = value.replace(/@z7note$/, '') || generateId();
        break;
      case 'DTSTART':
        // 传递完整的key（包含参数）和value给parseICSDate
        currentEvent.startTime = parseICSDate(key + ':' + value);
        // 提取时区信息
        if (key.includes('TZID=')) {
          const tzidMatch = key.match(/TZID=([^;:]+)/);
          if (tzidMatch) {
            currentEvent.timezone = tzidMatch[1];
          }
        }
        // 检查是否是全天事件
        if (key.includes('VALUE=DATE')) {
          currentEvent.allDay = true;
        }
        break;
      case 'DTEND':
        currentEvent.endTime = parseICSDate(key + ':' + value);
        break;
      case 'SUMMARY':
        currentEvent.title = unescapeICS(value);
        break;
      case 'DESCRIPTION':
        currentEvent.description = unescapeICS(value);
        break;
      case 'LOCATION':
        currentEvent.location = unescapeICS(value);
        break;
      case 'RRULE':
        currentEvent.recurrence = parseRRule(value);
        break;
      case 'X-MICROSOFT-CDO-ALLDAYEVENT':
        if (value === 'TRUE') {
          currentEvent.allDay = true;
        }
        break;
      case 'X-GOOGLE-CALENDAR-CONTENT-COLOR':
        currentEvent.color = value;
        break;
      case 'X-APPLE-STYLE':
        currentEvent.color = value;
        break;
      case 'X-GOOGLE-REMINDER':
        if (value === 'DEFAULT') {
          currentEvent.reminderBrowser = true;
        }
        break;
      case 'X-MICROSOFT-CDO-BUSYSTATUS':
        if (value === 'BUSY') {
          currentEvent.reminderBrowser = true;
        }
        break;
      case 'CLASS':
        currentEvent.visibility = value;
        break;
    }
  }

  return events;
}

/**
 * 检测ICS文件来源
 */
function detectICSSource(icsContent) {
  if (icsContent.includes('X-GOOGLE-CALENDAR-CONTENT-COLOR') ||
      icsContent.includes('google.com')) {
    return 'google';
  }
  if (icsContent.includes('X-MICROSOFT-CDO') ||
      icsContent.includes('outlook.com') ||
      icsContent.includes('Microsoft')) {
    return 'outlook';
  }
  return 'standard';
}

/**
 * 调整事件以适配Google Calendar
 */
function adjustForGoogle(event) {
  // Google Calendar 颜色映射
  if (event.color) {
    event.color = mapGoogleColor(event.color);
  }

  // 确保提醒设置
  if (!event.reminderBrowser && !event.reminderEmail) {
    event.reminderBrowser = true;
    event.reminderPreset = event.allDay ? 'same_day_9am' : '15m';
  }

  return event;
}

/**
 * 调整事件以适配Outlook
 */
function adjustForOutlook(event) {
  // Outlook 颜色映射
  if (event.color) {
    event.color = mapOutlookColor(event.color);
  }

  // Outlook 对提醒的支持有限
  if (event.reminderBrowser) {
    event.reminderCaldav = true; // 使用VALARM
  }

  if (!event.reminderPreset) {
    event.reminderPreset = event.allDay ? 'same_day_9am' : '15m';
  }

  return event;
}

/**
 * 将颜色映射到Google Calendar颜色
 */
function mapColorToGoogle(color) {
  const colorMap = {
    '#2563eb': '#4285f4', // 蓝色
    '#10b981': '#34a853', // 绿色
    '#f59e0b': '#fbbc04', // 黄色
    '#ef4444': '#ea4335', // 红色
    '#8b5cf6': '#a142f4', // 紫色
    '#ec4899': '#e91e63', // 粉色
    '#6366f1': '#673ab7'  // 靛蓝
  };
  return colorMap[color] || color;
}

/**
 * 将Google颜色映射到本地颜色
 */
/**
 * 将颜色映射到Outlook颜色
 */
function mapOutlookColor(color) {
  const colorMap = {
    '#2563eb': '#0078d4', // 蓝色
    '#10b981': '#107c10', // 绿色
    '#f59e0b': '#d83b01', // 黄色
    '#ef4444': '#a80000', // 红色
    '#8b5cf6': '#5c2d91', // 紫色
    '#ec4899': '#e3008c', // 粉色
    '#6366f1': '#008272'  // 青色
  };
  return colorMap[color] || color;
}

/**
 * 创建RRULE字符串
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
  unescapeICS,
  detectICSSource,
  mapColorToGoogle,
  mapGoogleColor,
  mapOutlookColor
};
