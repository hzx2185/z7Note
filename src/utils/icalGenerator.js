/**
 * iCal/ICS 文件生成工具 (重构版)
 * 统一使用本地时区格式,确保跨客户端兼容性
 */

const log = require('./logger');
const TimeHelper = require('./timeHelper');
const lunarHelper = require('./lunarHelper');

class ICalGenerator {
  static eventToICal(event) {
    const lines = [];
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id}`);
    lines.push(`DTSTAMP:${TimeHelper.toIcalUTC(event.updatedAt || event.createdAt || Date.now()/1000)}`);

    const tzid = event.timezone || 'Asia/Shanghai';

    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${TimeHelper.toIcalDate(event.startTime)}`);
      // 全天事件规范：DTEND 必须晚于 DTSTART。如果是一天，则 DTEND 是下一天的日期。
      let endTs = event.endTime || event.startTime;
      if (endTs <= event.startTime) {
          endTs = event.startTime + 86400; // 默认加一天
      }
      lines.push(`DTEND;VALUE=DATE:${TimeHelper.toIcalDate(endTs)}`);
    } else {
      // 使用本地时间格式 (带时区信息)
      lines.push(`DTSTART;TZID=${tzid}:${this.formatLocalTime(event.startTime)}`);
      if (event.endTime) {
        lines.push(`DTEND;TZID=${tzid}:${this.formatLocalTime(event.endTime)}`);
      }
    }

    if (event.title) lines.push(`SUMMARY:${this.escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${this.escapeText(event.description)}`);

    // 添加重复规则
    if (event.recurrence) {
      try {
        const r = typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence;
        let rrule = `FREQ=${r.type.toUpperCase()}`;
        if (r.interval && r.interval > 1) rrule += `;INTERVAL=${r.interval}`;
        if (r.daysOfWeek && r.daysOfWeek.length > 0) {
          const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
          rrule += `;BYDAY=${r.daysOfWeek.map(d => days[d]).join(',')}`;
        }
        if (r.dayOfMonth) rrule += `;BYMONTHDAY=${r.dayOfMonth}`;
        if (r.monthOfYear) rrule += `;BYMONTH=${r.monthOfYear}`;
        
        if (event.recurrenceEnd) {
          rrule += `;UNTIL=${TimeHelper.toIcalUTC(event.recurrenceEnd)}`;
        } else if (r.count) {
          rrule += `;COUNT=${r.count}`;
        }
        lines.push(`RRULE:${rrule}`);
      } catch (e) {
        log('WARN', '生成 RRULE 失败', { error: e.message, recurrence: event.recurrence });
      }
    }

    lines.push(`ORGANIZER:MAILTO:${event.username || 'user'}@z7note`);
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:OPAQUE');
    lines.push(`SEQUENCE:${Math.floor(event.updatedAt || 0)}`);

    // 提醒 (VALARM)
    if (event.reminderEmail || event.reminderBrowser || event.reminderCaldav) {
      lines.push('BEGIN:VALARM');
      lines.push(`X-WR-ALARMUID:ALARM-${event.id}`);
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:Reminder: ${this.escapeText(event.title || 'Event')}`);
      lines.push('TRIGGER:-PT15M');
      lines.push('END:VALARM');
    }

    lines.push('END:VEVENT');
    return this.foldLines(lines.join('\r\n'));
  }

  static todoToICal(todo) {
    const lines = [];
    lines.push('BEGIN:VTODO');
    lines.push(`UID:${todo.id}`);
    lines.push(`DTSTAMP:${TimeHelper.toIcalUTC(todo.updatedAt || todo.createdAt || Date.now()/1000)}`);
    
    if (todo.allDay) {
      if (todo.startTime) {
        lines.push(`DTSTART;VALUE=DATE:${TimeHelper.toIcalDate(todo.startTime)}`);
      }
      if (todo.dueDate) {
        lines.push(`DUE;VALUE=DATE:${TimeHelper.toIcalDate(todo.dueDate)}`);
      }
    } else {
      if (todo.startTime) {
        lines.push(`DTSTART;TZID=Asia/Shanghai:${this.formatLocalTime(todo.startTime)}`);
      }
      if (todo.dueDate) {
        lines.push(`DUE;TZID=Asia/Shanghai:${this.formatLocalTime(todo.dueDate)}`);
      }
    }
    
    if (todo.title) lines.push(`SUMMARY:${this.escapeText(todo.title)}`);
    if (todo.description) lines.push(`DESCRIPTION:${this.escapeText(todo.description)}`);
    
    lines.push(`PRIORITY:${this.mapPriorityToICal(todo.priority || 5)}`);
    lines.push(`STATUS:${todo.completed ? 'COMPLETED' : 'NEEDS-ACTION'}`);
    if (todo.completed) {
        lines.push(`COMPLETED:${TimeHelper.toIcalUTC(todo.updatedAt || Date.now()/1000)}`);
        lines.push('PERCENT-COMPLETE:100');
    } else {
        lines.push('PERCENT-COMPLETE:0');
    }
    
    lines.push(`SEQUENCE:${Math.floor(todo.updatedAt || 0)}`);
    lines.push('END:VTODO');
    return this.foldLines(lines.join('\r\n'));
  }

  static noteToICal(note) {
    const lines = [];
    lines.push('BEGIN:VJOURNAL');
    lines.push(`UID:${note.id}`);
    lines.push(`DTSTAMP:${TimeHelper.toIcalUTC(note.updatedAt || note.createdAt || Date.now()/1000)}`);
    lines.push(`DTSTART;TZID=Asia/Shanghai:${this.formatLocalTime(note.updatedAt || note.createdAt || Date.now()/1000)}`);
    
    if (note.title) lines.push(`SUMMARY:${this.escapeText(note.title)}`);
    if (note.content) lines.push(`DESCRIPTION:${this.escapeText(note.content)}`);
    
    lines.push('STATUS:FINAL');
    lines.push(`SEQUENCE:${Math.floor(note.updatedAt || 0)}`);
    lines.push('END:VJOURNAL');
    return this.foldLines(lines.join('\r\n'));
  }

  static generateCalendar(events = [], todos = [], username = 'user', notes = []) {
    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    // ... 略 ...
    
    // 在返回前，确保内容中没有破坏 CDATA 的序列
    // 实际的 generateCalendar 逻辑中，我们需要在包装 XML 时处理此问题
    // 这里的函数仅生成 ICS 文本内容

    lines.push('VERSION:2.0');
    lines.push('PRODID:-//z7Note//CalDAV Server//CN');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push(`X-WR-CALNAME:${username}@z7note`);
    lines.push('X-WR-TIMEZONE:Asia/Shanghai');

    // 添加 VTIMEZONE 提升跨客户端兼容性
    lines.push('BEGIN:VTIMEZONE');
    lines.push('TZID:Asia/Shanghai');
    lines.push('BEGIN:STANDARD');
    lines.push('DTSTART:19700101T000000');
    lines.push('TZOFFSETFROM:+0800');
    lines.push('TZOFFSETTO:+0800');
    lines.push('TZNAME:CST');
    lines.push('END:STANDARD');
    lines.push('END:VTIMEZONE');

    const calendarContent = lines.join('\r\n');
    const parts = [this.foldLines(calendarContent)];

    if (events && events.length > 0) {
      events.forEach(e => {
        // 核心兼容性处理：农历重复事件无法在大部分客户端直接识别
        // 我们将其展开为未来 5 年的独立公历事件进行同步
        if (e.recurrence) {
          try {
            const r = typeof e.recurrence === 'string' ? JSON.parse(e.recurrence) : e.recurrence;
            if (r.type && r.type.startsWith('lunar_')) {
              const now = Math.floor(Date.now() / 1000);
              const fiveYearsLater = now + (5 * 365 * 24 * 3600);
              const expandedLunar = lunarHelper.generateLunarRecurringEvents(e, now - (365 * 24 * 3600), fiveYearsLater);
              
              expandedLunar.forEach(instance => {
                parts.push(this.eventToICal(instance));
              });
              return;
            }
          } catch (err) {
            log('WARN', 'ICS 生成中农历展开失败', { error: err.message });
          }
        }
        parts.push(this.eventToICal(e));
      });
    }
    
    if (todos && todos.length > 0) {
      todos.forEach(t => parts.push(this.todoToICal(t)));
    }

    if (notes && notes.length > 0) {
      notes.forEach(n => parts.push(this.noteToICal(n)));
    }

    parts.push('END:VCALENDAR');
    return parts.join('\r\n');
  }

  static escapeText(text) {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  /**
   * 折行处理 (RFC 5545)
   * 每行不能超过 75 个字节,超过部分需另起一行并以空格开头
   */
  static foldLines(content) {
    return content.split(/\r?\n/).map(line => {
      if (line.length <= 75) return line;
      let result = '';
      let currentLine = line;
      while (currentLine.length > 75) {
        result += currentLine.substring(0, 75) + '\r\n ';
        currentLine = currentLine.substring(75);
      }
      result += currentLine;
      return result;
    }).join('\r\n');
  }

  // 格式化本地时间 (YYYYMMDDTHHMMSS) - 显式使用 Asia/Shanghai 时区
  static formatLocalTime(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    
    try {
      // 使用 Intl 确保无论服务器在什么时区,都按上海时区格式化
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      });
      
      const parts = formatter.formatToParts(d);
      const getPart = (type) => parts.find(p => p.type === type).value;
      
      const y = getPart('year');
      const m = getPart('month');
      const day = getPart('day');
      let h = getPart('hour');
      if (h === '24') h = '00';
      const min = getPart('minute');
      const s = getPart('second');
      
      return `${y}${m}${day}T${h}${min}${s}`;
    } catch (e) {
      // 降级方案
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${y}${m}${day}T${h}${min}${s}`;
    }
  }

  /**
   * 将系统优先级映射到 iCal 优先级 (1-9)
   * 系统: 1(高), 3(中), 5(低)
   * iCal: 1(高), 5(中), 9(低), 0(未指定)
   */
  static mapPriorityToICal(priority) {
    if (priority <= 1) return 1;
    if (priority <= 3) return 5;
    return 9;
  }

  /**
   * 将 iCal 优先级映射到系统优先级
   */
  static mapPriorityFromICal(priority) {
    const p = parseInt(priority);
    if (p >= 1 && p <= 4) return 1;
    if (p === 5) return 3;
    if (p >= 6 && p <= 9) return 5;
    return 5;
  }
}

module.exports = ICalGenerator;
