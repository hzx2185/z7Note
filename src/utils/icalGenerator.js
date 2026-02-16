/**
 * iCal/ICS 文件生成工具
 */

const log = require('./logger');

class ICalGenerator {
  /**
   * 将事件转换为 iCal 格式
   */
  static eventToICal(event) {
    const lines = [];

    // VEVENT 开始
    lines.push('BEGIN:VEVENT');

    // UID（唯一标识符）
      // UID（唯一标识符）- 直接使用event.id，不添加后缀
      // 注意：event.id应该包含完整的UID（如果客户端发送了完整UID）
      lines.push(`UID:${event.id}`);

    // DTSTAMP（创建时间）
    const created = event.createdAt || event.updatedAt || Date.now();
    const createdDate = new Date(created * 1000);
    lines.push(`DTSTAMP:${this.formatDateTime(createdDate)}`);

      // DTSTART（开始时间）
      const startDate = new Date(event.startTime * 1000);
      if (event.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${this.formatDate(startDate)}`);
      } else if (event.timezone) {
        // 如果有时区信息，输出带TZID的本地时间
        lines.push(`DTSTART;TZID=${event.timezone}:${this.formatDateTimeWithTimezone(startDate, event.timezone)}`);
      } else {
        lines.push(`DTSTART:${this.formatDateTime(startDate)}`);
      }
      
      // DTEND（结束时间）
      if (event.endTime) {
        const endDate = new Date(event.endTime * 1000);
        if (event.allDay) {
          // 全天事件的结束时间需要加一天
          endDate.setUTCDate(endDate.getUTCDate() + 1);
          lines.push(`DTEND;VALUE=DATE:${this.formatDate(endDate)}`);
        } else if (event.timezone) {
          // 如果有时区信息，输出带TZID的本地时间
          lines.push(`DTEND;TZID=${event.timezone}:${this.formatDateTimeWithTimezone(endDate, event.timezone)}`);
        } else {
          lines.push(`DTEND:${this.formatDateTime(endDate)}`);
        }
      }
      

    // SUMMARY（标题）
    if (event.title) {
      lines.push(`SUMMARY:${this.escapeText(event.title)}`);
    }

    // DESCRIPTION（描述）
    if (event.description) {
      lines.push(`DESCRIPTION:${this.escapeText(event.description)}`);
    }

    // LOCATION（位置，如果有）
    // 目前没有位置字段，预留

    // ORGANIZER（组织者）
    lines.push(`ORGANIZER:MAILTO:${event.username}@z7note`);

    // STATUS（状态）
    lines.push('STATUS:CONFIRMED');

    // TRANSP（透明度）
    lines.push('TRANSP:OPAQUE');

    // SEQUENCE（序列号，用于同步）
    lines.push(`SEQUENCE:${Math.floor((event.updatedAt || event.createdAt || 0) / 1000)}`);

    // LAST-MODIFIED（最后修改时间）
    const modified = event.updatedAt || event.createdAt || Date.now();
    const modifiedDate = new Date(modified * 1000);
    lines.push(`LAST-MODIFIED:${this.formatDateTime(modifiedDate)}`);

    // COLOR（颜色，非标准，但很多客户端支持）
    if (event.color) {
      lines.push(`X-APPLE-CALENDAR-COLOR:${event.color}`);
    }

    // VEVENT 结束
    lines.push('END:VEVENT');

    return lines.join('\r\n');
  }

  /**
   * 将待办事项转换为 iCal VTODO 格式
   */
  static todoToICal(todo) {
    const lines = [];

    // VTODO 开始
    lines.push('BEGIN:VTODO');

    // UID
    lines.push(`UID:${todo.id}@z7note`);

    // DTSTAMP
    const created = todo.createdAt || todo.updatedAt || Date.now();
    const createdDate = new Date(created * 1000);
    lines.push(`DTSTAMP:${this.formatDateTime(createdDate)}`);

    // DUE（截止日期）
    if (todo.dueDate) {
      const dueDate = new Date(todo.dueDate * 1000);
      lines.push(`DUE;VALUE=DATE:${this.formatDate(dueDate)}`);
    }

    // SUMMARY
    if (todo.title) {
      lines.push(`SUMMARY:${this.escapeText(todo.title)}`);
    }

    // DESCRIPTION
    if (todo.description) {
      lines.push(`DESCRIPTION:${this.escapeText(todo.description)}`);
    }

    // PRIORITY（优先级）
    // iCal 优先级：1-9（1最高），转换为：z7Note的1-3（1最低）
    const icalPriority = this.mapPriority(todo.priority);
    lines.push(`PRIORITY:${icalPriority}`);

    // STATUS（状态）
    if (todo.completed) {
      lines.push('STATUS:COMPLETED');
      // COMPLETED（完成时间）
      const completedTime = todo.updatedAt || Date.now();
      const completedDate = new Date(completedTime * 1000);
      lines.push(`COMPLETED:${this.formatDateTime(completedDate)}`);
    } else {
      lines.push('STATUS:NEEDS-ACTION');
    }

    // PERCENT-COMPLETE（完成百分比）
    lines.push(`PERCENT-COMPLETE:${todo.completed ? 100 : 0}`);

    // SEQUENCE
    lines.push(`SEQUENCE:${Math.floor((todo.updatedAt || todo.createdAt || 0) / 1000)}`);

    // LAST-MODIFIED
    const modified = todo.updatedAt || todo.createdAt || Date.now();
    const modifiedDate = new Date(modified * 1000);
    lines.push(`LAST-MODIFIED:${this.formatDateTime(modifiedDate)}`);

    // VTODO 结束
    lines.push('END:VTODO');

    return lines.join('\r\n');
  }

  /**
   * 生成完整的 iCal 日历文件
   */
  static generateCalendar(events, todos, username) {
    const lines = [];

    // VCALENDAR 开始
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//z7Note//CalDAV Server//CN');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push(`X-WR-CALNAME:${username}@z7note`);
    lines.push('X-WR-TIMEZONE:Asia/Shanghai');
    lines.push('X-WR-CALDESC:z7Note Calendar');

    // 时区信息
    lines.push('BEGIN:VTIMEZONE');
    lines.push('TZID:Asia/Shanghai');
    lines.push('BEGIN:DAYLIGHT');
    lines.push('TZOFFSETFROM:+0800');
    lines.push('TZOFFSETTO:+0900');
    lines.push('DTSTART:20070311T020000');
    lines.push('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    lines.push('TZNAME:中国夏令时');
    lines.push('END:DAYLIGHT');
    lines.push('BEGIN:STANDARD');
    lines.push('TZOFFSETFROM:+0900');
    lines.push('TZOFFSETTO:+0800');
    lines.push('DTSTART:20071111T020000');
    lines.push('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
    lines.push('TZNAME:中国标准时间');
    lines.push('END:STANDARD');
    lines.push('END:VTIMEZONE');

    // 添加事件
    if (events && events.length > 0) {
      events.forEach(event => {
        lines.push(this.eventToICal(event));
      });
    }

    // 添加待办事项
    if (todos && todos.length > 0) {
      todos.forEach(todo => {
        lines.push(this.todoToICal(todo));
      });
    }

    // VCALENDAR 结束
    lines.push('END:VCALENDAR');

    return lines.join('\r\n');
  }

  /**
   * 格式化日期时间（YYYYMMDDTHHMMSSZ）
   */
  static formatDateTime(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  }

  /**
   * 格式化日期时间（带时区，YYYYMMDDTHHMMSS）
   * 将UTC时间转换为指定时区的本地时间
   */
  static formatDateTimeWithTimezone(date, timezone) {
    // 获取时区偏移
    const offset = this.getTimezoneOffset(timezone);
    if (offset === null) {
      // 如果无法识别时区，返回UTC时间
      return this.formatDateTime(date);
    }
    
    // 将UTC时间转换为本地时间
    const localTime = new Date(date.getTime() + (offset * 60 * 60 * 1000));
    
    const year = localTime.getUTCFullYear();
    const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localTime.getUTCDate()).padStart(2, '0');
    const hours = String(localTime.getUTCHours()).padStart(2, '0');
    const minutes = String(localTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(localTime.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
  }

  /**
   * 获取时区偏移（小时）
   * @param {string} timezone - 时区ID，如 'Asia/Shanghai'
   * @returns {number|null} - 相对于UTC的偏移小时数，东时区为正
   */
  static getTimezoneOffset(timezone) {
    // 常见时区映射表
    const timezoneMap = {
      'Asia/Shanghai': 8,
      'Asia/Chongqing': 8,
      'Asia/Hong_Kong': 8,
      'Asia/Taipei': 8,
      'Asia/Singapore': 8,
      'Asia/Tokyo': 9,
      'Asia/Seoul': 9,
      'Asia/Dubai': 4,
      'Asia/Kolkata': 5.5,
      'Europe/London': 0,
      'Europe/Paris': 1,
      'Europe/Berlin': 1,
      'Europe/Moscow': 3,
      'America/New_York': -5,
      'America/Chicago': -6,
      'America/Denver': -7,
      'America/Los_Angeles': -8,
      'America/Sao_Paulo': -3,
      'Australia/Sydney': 10,
      'Pacific/Auckland': 12
    };
    
    return timezoneMap[timezone] !== undefined ? timezoneMap[timezone] : null;
  }

  /**
   * 格式化日期（YYYYMMDD）
   */
  static formatDate(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * 转义 iCal 文本中的特殊字符
   */
  static escapeText(text) {
    if (!text) return '';
    
    // 转义特殊字符
    text = text.replace(/\\/g, '\\\\'); // 反斜杠
    text = text.replace(/;/g, '\\;');   // 分号
    text = text.replace(/,/g, '\\,');   // 逗号
    text = text.replace(/\n/g, '\\n');  // 换行
    
    // 处理长行（超过75字符需要折行）
    const maxLength = 75;
    if (text.length <= maxLength) {
      return text;
    }

    // 按字符折行
    const lines = [];
    for (let i = 0; i < text.length; i += maxLength - 1) {
      lines.push(text.substring(i, i + maxLength - 1));
    }
    return lines.join('\r\n ');
  }

  /**
   * 映射优先级
   * z7Note: 1(低), 2(中), 3(高)
   * iCal: 1(高) - 9(低)
   */
  static mapPriority(priority) {
    const map = {
      1: 9,  // 低 -> 9
      2: 5,  // 中 -> 5
      3: 1   // 高 -> 1
    };
    return map[priority] || 5;
  }

  /**
   * 反向映射优先级
   */
  static mapPriorityFromICal(icalPriority) {
    const map = {
      1: 3,  // 高 -> 高
      2: 3,
      3: 3,
      4: 3,
      5: 2,  // 中 -> 中
      6: 2,
      7: 2,
      8: 2,
      9: 1   // 低 -> 低
    };
    return map[icalPriority] || 2;
  }
}

module.exports = ICalGenerator;
