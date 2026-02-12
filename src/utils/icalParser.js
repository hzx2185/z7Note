/**
 * iCal/ICS 文件解析工具
 */

const log = require('./logger');

class ICalParser {
  /**
   * 解析 iCal 内容，提取事件和待办事项
   */
  static parse(icalContent) {
    const result = {
      events: [],
      todos: []
    };

    try {
      // 预处理：移除换行转义
      const lines = icalContent
        .replace(/\r\n /g, '') // 折行的内容合并
        .split(/\r?\n/);      // 按行分割

      let currentComponent = null;
      let currentItem = {};
      let componentStack = []; // 组件栈,用于处理嵌套组件

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 跳过空行
        if (!line) continue;

        // 解析键值对
        // 格式: "DTSTART;VALUE=DATE:20260212" 或 "DTSTART:20260212"
        const colonIndex = line.indexOf(':');
        const semicolonIndex = line.indexOf(';');

        let key, value;
        if (colonIndex === -1) {
          continue; // 无效行,跳过
        }

        // key是冒号之前的所有内容(包括参数)
        key = line.substring(0, colonIndex).toUpperCase();
        value = line.substring(colonIndex + 1);

        // 移除转义
        value = this.unescapeText(value);

        // 处理组件开始
        if (key === 'BEGIN') {
          if (value === 'VEVENT') {
            currentComponent = 'event';
            currentItem = {};
          } else if (value === 'VTODO') {
            currentComponent = 'todo';
            currentItem = {};
          }
          componentStack.push(value);
          continue;
        }

        // 处理组件结束
        if (key === 'END') {
          componentStack.pop();
          if (value === 'VEVENT' && currentComponent === 'event') {
            result.events.push(this.parseEvent(currentItem));
            if (componentStack.length === 0) {
              currentComponent = null;
              currentItem = {};
            }
          } else if (value === 'VTODO' && currentComponent === 'todo') {
            result.todos.push(this.parseTodo(currentItem));
            if (componentStack.length === 0) {
              currentComponent = null;
              currentItem = {};
            }
          }
          continue;
        }

        // 解析属性 - 只在event或todo组件中解析
        if ((currentComponent === 'event' || currentComponent === 'todo') && currentItem) {
          this.parseProperty(key, value, currentItem);
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

    const event = {
      id: this.extractUID(item.UID),
      title: item.SUMMARY,
      description: item.DESCRIPTION,
      startTime: startTime && typeof startTime === 'object'
        ? this.parseDateTime(startTime.value, startTime.params)
        : this.parseDateTime(startTime),
      endTime: endTime && typeof endTime === 'object'
        ? this.parseDateTime(endTime.value, endTime.params)
        : this.parseDateTime(endTime),
      allDay: this.isAllDay(item['DTSTART']),
      color: item['X-APPLE-CALENDAR-COLOR'] || '#2563eb',
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000)
    };

    // 处理全天事件
    if (event.allDay && event.endTime) {
      // 全天事件的结束时间通常是第二天，需要减去一天
      const endDate = new Date(event.endTime * 1000);
      endDate.setDate(endDate.getDate() - 1);
      event.endTime = Math.floor(endDate.getTime() / 1000);
    }

    return event;
  }

  /**
   * 解析单个待办事项
   */
  static parseTodo(item) {
    // 处理截止日期（可能包含参数）
    const dueDate = item['DUE'];

    const todo = {
      id: this.extractUID(item.UID),
      title: item.SUMMARY,
      description: item.DESCRIPTION,
      dueDate: dueDate && typeof dueDate === 'object'
        ? this.parseDate(dueDate.value)
        : this.parseDate(dueDate),
      priority: ICalGenerator.mapPriorityFromICal(item.PRIORITY || 5),
      completed: item.STATUS === 'COMPLETED',
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000)
    };

    return todo;
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
    // UID 格式通常是：id@domain
    const match = uid.match(/^([^@]+)@/);
    return match ? match[1] : uid;
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
    let date;

    if (isUTC) {
      // UTC时间
      date = new Date(
        Date.UTC(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hours),
          parseInt(minutes),
          parseInt(seconds)
        )
      );
    } else {
      // 本地时间（带TZID参数或浮动时间）
      // 如果有TZID参数,已经是指定时区的本地时间
      // 如果没有TZID,作为浮动时间处理
      date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
        parseInt(seconds)
      );
    }

    return Math.floor(date.getTime() / 1000);
  }

  /**
   * 解析日期
   */
  static parseDate(value) {
    if (!value) return null;

    // 解析日期格式（YYYYMMDD）
    const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) return null;

    const [, year, month, day] = match;
    const date = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      0, 0, 0, 0
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
