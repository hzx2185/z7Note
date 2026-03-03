/**
 * iCal/ICS 文件解析工具
 */

const log = require('./logger');
const ICalGenerator = require('./icalGenerator');

class ICalParser {
  /**
   * 解析 iCal 内容，提取事件和待办事项
   */
  static parse(icalContent) {
      const result = {
        events: [],
        todos: [],
        notes: []
      };

    try {
      // 预处理：移除换行转义
      const lines = icalContent
        .replace(/\r?\n /g, '') // 折行的内容合并 (RFC 5545: 换行后接空格)
        .split(/\r?\n/);      // 按行分割

      let currentComponent = null;
      let currentItem = {};
      let componentStack = []; // 组件栈,用于处理嵌套组件
      let inAlarm = false; // 是否在 VALARM 组件内

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 跳过空行
        if (!line) continue;

        // 解析键值对
        // 格式: "DTSTART;VALUE=DATE:20260212" 或 "DTSTART:20260212"
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const keyPart = line.substring(0, colonIndex).toUpperCase();
        const value = line.substring(colonIndex + 1);

        // 分离属性名和参数
        const semicolonIndex = keyPart.indexOf(';');
        const key = semicolonIndex > 0 ? keyPart.substring(0, semicolonIndex) : keyPart;
        const params = {};

        if (semicolonIndex > 0) {
          const paramString = keyPart.substring(semicolonIndex + 1);
          // 改进参数解析，处理带引号的情况
          const paramRegex = /([^=;]+)=([^;"]+|"[^"]*")/g;
          let match;
          while ((match = paramRegex.exec(paramString)) !== null) {
            let pVal = match[2];
            if (pVal.startsWith('"') && pVal.endsWith('"')) {
              pVal = pVal.substring(1, pVal.length - 1);
            }
            params[match[1].toUpperCase()] = pVal;
          }
        }

        // 处理组件开始
        if (key === 'BEGIN') {
          const componentName = value.toUpperCase();
          if (componentName === 'VEVENT') {
            currentComponent = 'event';
            currentItem = { alarms: [] };
          } else if (componentName === 'VTODO') {
            currentComponent = 'todo';
            currentItem = {};
          } else if (componentName === 'VJOURNAL') {
            currentComponent = 'note';
            currentItem = {};
          } else if (componentName === 'VALARM') {
            inAlarm = true;
          }
          componentStack.push(componentName);
          continue;
        }

        // 处理组件结束
        if (key === 'END') {
          const componentName = value.toUpperCase();
          componentStack.pop();
          
          if (componentName === 'VEVENT' && currentComponent === 'event') {
            result.events.push(this.parseEvent(currentItem));
          } else if (componentName === 'VTODO' && currentComponent === 'todo') {
            result.todos.push(this.parseTodo(currentItem));
          } else if (componentName === 'VJOURNAL' && currentComponent === 'note') {
            result.notes.push(this.parseNote(currentItem));
          } else if (componentName === 'VALARM') {
            inAlarm = false;
            if (currentComponent === 'event') {
              currentItem.alarms.push(true);
            }
          }
          
          if (componentStack.length === 0) {
            currentComponent = null;
            currentItem = {};
          }
          continue;
        }

        // 解析属性 - 只在主组件中解析，且不在闹钟组件内
        if (currentComponent && currentItem && !inAlarm) {
          const unescapedValue = this.unescapeText(value);
          if (['DTSTART', 'DTEND', 'DUE', 'CREATED', 'LAST-MODIFIED', 'DESCRIPTION'].includes(key)) {
            currentItem[key] = { value: unescapedValue, params }; 
          } else {
            currentItem[key] = unescapedValue;
          }
        }
      }

      log('INFO', 'iCal 解析成功', {
        events: result.events.length,
        todos: result.todos.length
      });

    } catch (error) {
      log('ERROR', 'iCal 解析失败', { error: error.message, stack: error.stack });
    }

    return result;
  }

  /**
   * 解析单个事件
   */
  static parseEvent(item) {
    // 处理日期时间属性（可能包含参数）
    const startTime = item['DTSTART'];
    const endTime = item['DTEND'];
    const descObj = item['DESCRIPTION'];

    const event = {
      id: this.extractUID(item.UID),
      title: item.SUMMARY,
      description: this.parseDescription(descObj),
      startTime: startTime && typeof startTime === 'object'
        ? this.parseDateTime(startTime.value, startTime.params)
        : this.parseDateTime(startTime),
      endTime: endTime && typeof endTime === 'object'
        ? this.parseDateTime(endTime.value, endTime.params)
        : this.parseDateTime(endTime),
      allDay: this.isAllDay(item['DTSTART']),
      color: item['X-APPLE-CALENDAR-COLOR'] || '#2563eb',
      reminderCaldav: item.alarms && item.alarms.length > 0 ? 1 : 0,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000)
    };

    // 时区漂移容错：如果时间恰好是 16:00 (UTC 00:00)，且客户端未明确指定时区，尝试将其视为本地 00:00 的全天事件
    if (!event.allDay && event.startTime % 86400 === 57600) { // 57600 是 16:00 的秒数
        // 这是一个可疑的漂移项，但我们保持原始数据，仅在 ID 匹配或特定条件下处理
    }

    // 处理全天事件
    if (event.allDay) {
      if (event.endTime) {
        const span = event.endTime - event.startTime;
        // 如果结束时间等于开始时间，或者明显没跨天，强补一天
        if (span <= 0) {
            event.endTime = event.startTime + 86400;
        } else if (span > 86400 && span % 86400 !== 0) {
            // 如果不是整天，向上取整到下一天凌晨
            const endDate = new Date(event.endTime * 1000);
            endDate.setUTCHours(0,0,0,0);
            endDate.setUTCDate(endDate.getUTCDate() + 1);
            event.endTime = Math.floor(endDate.getTime() / 1000);
        }
      } else {
        // 没有 endTime 时，默认加一天
        event.endTime = event.startTime + 86400;
      }
    }

    // 解析时区ID (TZID)
    if (startTime && typeof startTime === 'object' && startTime.params && startTime.params.TZID) {
        // 将时区转换为标准格式（首字母大写，其余小写）
        const tzid = startTime.params.TZID;
        event.timezone = tzid.split('/').map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join('/');
    }

    // 解析重复规则 (RRULE)
    if (item.RRULE) {
      event.recurrence = this.parseRRULE(item.RRULE);
      
      // 如果是每周重复但没有指定 daysOfWeek，则使用事件本身的星期几
      if (event.recurrence && event.recurrence.type === 'weekly' && !event.recurrence.daysOfWeek) {
        const startDate = new Date(event.startTime * 1000);
        event.recurrence.daysOfWeek = [startDate.getDay()];
      }

      // 修正: 将 recurrenceEnd 提升到 event 的顶级属性
      if (event.recurrence && event.recurrence.recurrenceEnd) {
        event.recurrenceEnd = event.recurrence.recurrenceEnd;
        delete event.recurrence.recurrenceEnd;
      }
    }

    return event;
  }

  /**
   * 解析RRULE重复规则
   * @param {string} rrule - RRULE字符串,如 "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
   * @returns {Object|null} - 重复规则对象
   */
  static parseRRULE(rrule) {
    if (!rrule) return null;

    try {
      const result = {};
      const parts = rrule.split(';');

      parts.forEach(part => {
        const [key, value] = part.split('=');

        switch (key.toUpperCase()) {
          case 'FREQ':
            const freqMap = { 'DAILY': 'daily', 'WEEKLY': 'weekly', 'MONTHLY': 'monthly', 'YEARLY': 'yearly' };
            result.type = freqMap[value.toUpperCase()];
            break;
          case 'INTERVAL':
            result.interval = parseInt(value);
            break;
          case 'BYDAY':
            const dayMap = { 'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6 };
            result.daysOfWeek = value.split(',').map(d => dayMap[d.toUpperCase()]);
            break;
          case 'BYMONTHDAY':
            result.dayOfMonth = parseInt(value);
            break;
          case 'BYMONTH':
            result.monthOfYear = parseInt(value);
            break;
          case 'UNTIL':
            // UNTIL格式: 20260213T000000Z
            result.recurrenceEnd = this.parseDateTime(value.replace(/Z$/, ''));
            break;
          case 'COUNT':
            result.count = parseInt(value);
            break;
        }
      });

      return Object.keys(result).length > 0 ? result : null;
    } catch (e) {
      console.error('解析RRULE失败:', rrule, e);
      return null;
    }
  }

  /**
   * 解析单个待办事项
   */
  static parseTodo(item) {
    // 处理截止日期（可能包含参数）
    const dueDate = item['DUE'];
    const descObj = item['DESCRIPTION'];

    const todo = {
      id: this.extractUID(item.UID),
      title: item.SUMMARY,
      description: this.parseDescription(descObj),
      dueDate: dueDate && typeof dueDate === 'object'
        ? this.parseDateTime(dueDate.value, dueDate.params)
        : this.parseDateTime(dueDate),
      priority: ICalGenerator.mapPriorityFromICal(item.PRIORITY || 5),
      completed: item.STATUS === 'COMPLETED',
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000)
    };

    return todo;
  }
  
  /**
   * 解析笔记（VJOURNAL）
   */
  static parseNote(item) {
    const descObj = item['DESCRIPTION'];
    const note = {
      id: this.extractUID(item.UID),
      title: item.SUMMARY || '未命名',
      content: this.parseDescription(descObj) || '',
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000)
    };
  
    return note;
  }

  /**
   * 统一解析描述字段，处理 Thunderbird 的 HTML 前缀和双内容（HTML/Text）合并问题
   */
  static parseDescription(desc) {
    if (!desc) return '';
    const isObj = typeof desc === 'object';
    let value = isObj ? desc.value : desc;
    const params = isObj ? (desc.params || {}) : {};
    
    if (!value) return '';

    // 1. 识别是否为 HTML 增强格式
    const isHtml = (params.FMTTYPE && params.FMTTYPE.toLowerCase().includes('html')) || 
                   value.toLowerCase().startsWith('text/html,');

    if (isHtml || value.includes('":')) {
      // 尝试剥离 text/html, 前缀
      if (value.toLowerCase().startsWith('text/htmlSource')) {
        // 容错处理
      }
      if (value.toLowerCase().startsWith('text/html,')) {
        value = value.substring(10);
      }

      // 2. 查找双重内容分隔符 ": 
      // Thunderbird 格式通常是 "HTML部分":纯文本部分
      // 即使没有前缀，如果内容符合 A":A 或 <html>":A，则说明是双重内容
      const delimiterIndex = value.lastIndexOf('":');
      if (delimiterIndex !== -1) {
        const part1 = value.substring(0, delimiterIndex);
        const part2 = value.substring(delimiterIndex + 2);
        
        // 如果两部分相同，或者第一部分包含明显的 HTML 转义/标签，或者是清除后的残留
        if (part1 === part2 || part1.includes('%3C') || part1.includes('<') || part2 === '') {
          return part2;
        }
      }
    }

    // 3. 处理包裹的引号
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }

    return value;
  }

  /**
   * 解析属性
   */
  static parseProperty(key, value, item) {
    // 分离属性名和参数
    // key格式可能是: "DTSTART;VALUE=DATE" (冒号在值中) 或 "DTSTART:20260212"
    const semicolonIndex = key.indexOf(';');
    const mainKey = semicolonIndex > 0 ? key.substring(0, semicolonIndex) : key;
    const params = {};

    // 解析参数（如 DTSTART;VALUE=DATE 中的 VALUE=DATE）
    if (semicolonIndex > 0) {
      const paramString = key.substring(semicolonIndex + 1);
      const paramPairs = paramString.split(';');
      paramPairs.forEach(pair => {
        const [k, v] = pair.split('=');
        if (k && v) {
          params[k] = v;
        }
      });
    }

    // 对于日期时间属性,传递参数给解析函数
    if (['DTSTART', 'DTEND', 'DUE', 'CREATED', 'LAST-MODIFIED'].includes(mainKey)) {
      item[mainKey] = { value, params };
    } else {
      item[mainKey] = value;
    }
  }

  /**
   * 从 UID 中提取 ID
   */
  static extractUID(uid) {
      if (!uid) return null;
      // 保留完整的UID，不移除@后面的部分
      // 这样可以确保客户端发送的UID和服务器返回的UID一致
      return uid;
  }

  /**
   * 解析日期时间
   */
  static parseDateTime(value, params = {}) {
    if (!value) return null;

    // 检查是否是日期格式（YYYYMMDD）
    if (/^\d{8}$/.test(value)) {
      return this.parseDate(value);
    }

    // 解析日期时间格式（YYYYMMDDTHHMMSSZ 或 YYYYMMDDTHHMMSS）
    const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
    if (!match) return null;

    const [, year, month, day, hours, minutes, seconds, isUTC] = match;

    if (isUTC) {
      // UTC时间 (例如 ...Z)，直接计算UTC时间戳，避免服务器本地时区影响
      const timestamp = Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
        parseInt(seconds)
      );
      return Math.floor(timestamp / 1000);
    } else {
      // 浮动时间 (没有 'Z')
      // 如果有TZID参数，需要根据时区转换为UTC时间
      if (params && params.TZID) {
        const timezone = params.TZID;
        // 处理常见时区
        const offset = this.getTimezoneOffset(timezone);
        if (offset !== null) {
          // 先构造本地时间的时间戳（当作UTC处理）
          const localTimestamp = Date.UTC(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hours),
            parseInt(minutes),
            parseInt(seconds)
          );
          // 减去时区偏移得到UTC时间
          const utcTimestamp = localTimestamp - (offset * 60 * 60 * 1000);
          return Math.floor(utcTimestamp / 1000);
        }
      }
      
      // 如果没有TZID或无法识别时区，当作服务器本地时间处理
      // 注意：如果客户端和服务器时区不同，这可能不是预期的行为
      const date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
        parseInt(seconds)
      );
      return Math.floor(date.getTime() / 1000);
    }
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
   * 解析日期（全天事件）
   */
  static parseDate(value) {
    if (!value) return null;

    // 解析日期格式（YYYYMMDD）
    const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) return null;

    const [, year, month, day] = match;
    // 全天事件使用UTC，避免时区问题
    const date = new Date(
      Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        0, 0, 0, 0
      )
    );

    return Math.floor(date.getTime() / 1000);
  }

  /**
   * 判断是否是全天事件
   */
  static isAllDay(keyValue) {
    if (!keyValue) return false;
    // keyValue可能是字符串或对象{value, params}
    if (typeof keyValue === 'string') {
      // 字符串格式: "DTSTART;VALUE=DATE" (没有冒号)
      return keyValue.includes('VALUE=DATE');
    } else if (keyValue && keyValue.params) {
      // 对象格式: { value: "20260212", params: { VALUE: "DATE" } }
      return keyValue.params.VALUE === 'DATE';
    }
    return false;
  }

  /**
   * 移除文本转义
   */
  static unescapeText(text) {
    if (!text) return '';
    
    text = text.replace(/\\n/g, '\n');  // 换行
    text = text.replace(/\\,/g, ',');   // 逗号
    text = text.replace(/\\;/g, ';');   // 分号
    text = text.replace(/\\\\/g, '\\'); // 反斜杠
    
    return text;
  }
}

module.exports = ICalParser;
