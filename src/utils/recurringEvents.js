/**
 * 重复事件工具函数
 */

const { generateLunarRecurringEvents } = require('./lunarHelper');

/**
 * 生成重复事件
 * @param {Object} masterEvent - 主事件
 * @param {number} startDate - 开始日期(秒时间戳)
 * @param {number} endDate - 结束日期(秒时间戳)
 * @returns {Array} 生成的重复事件列表
 */
function generateRecurringEvents(masterEvent, startDate, endDate) {
  const events = [];
  const { recurrence, recurrenceEnd, startTime, endTime } = masterEvent;

  if (!recurrence) return events;

  const recurrenceType = recurrence.type; // 'daily', 'weekly', 'monthly', 'yearly'
  // 如果是农历重复事件,使用农历生成逻辑
  if (recurrence.type && recurrence.type.startsWith('lunar_')) {
    return generateLunarRecurringEvents(masterEvent, startDate, endDate);
  }

  const interval = recurrence.interval || 1; // 重复间隔
  const daysOfWeek = recurrence.daysOfWeek || []; // 周几重复(仅weekly)
  const dayOfMonth = recurrence.dayOfMonth; // 每月的第几天(仅monthly)
  const monthOfYear = recurrence.monthOfYear; // 每年的第几个月(仅yearly)

  // 重复结束日期
  const endRecurrenceDate = recurrenceEnd ? new Date(recurrenceEnd * 1000) : new Date(endDate * 1000);
  endRecurrenceDate.setHours(23, 59, 59, 999);

  // 生成重复事件
  let currentDate = new Date(startTime * 1000);
  currentDate.setHours(0, 0, 0, 0);

  const maxIterations = 1000; // 防止无限循环
  let iterations = 0;

  while (currentDate <= endRecurrenceDate && iterations < maxIterations) {
    iterations++;

    // 检查当前日期是否在查询范围内
    const currentTimestamp = Math.floor(currentDate.getTime() / 1000);
    if (currentTimestamp >= startDate && currentTimestamp <= endDate) {
      const event = {
        ...masterEvent,
        id: `${masterEvent.id}_${currentTimestamp}`,
        isRecurringInstance: true,
        parentEventId: masterEvent.id,
        startTime: currentTimestamp,
        endTime: endTime ? currentTimestamp + (endTime - startTime) : null
      };
      events.push(event);
    }

    // 计算下一个日期
    switch (recurrenceType) {
      case 'daily':
        currentDate.setDate(currentDate.getDate() + interval);
        break;

      case 'weekly':
        if (daysOfWeek.length > 0) {
          // 指定周几重复
          const currentDay = currentDate.getDay();
          let nextDay = daysOfWeek.find(d => d > currentDay);
          if (nextDay === undefined) {
            // 下一周
            nextDay = daysOfWeek[0];
            currentDate.setDate(currentDate.getDate() + (7 - currentDay + nextDay));
          } else {
            currentDate.setDate(currentDate.getDate() + (nextDay - currentDay));
          }
        } else {
          // 每周重复
          currentDate.setDate(currentDate.getDate() + (7 * interval));
        }
        break;

      case 'monthly':
        if (dayOfMonth) {
          // 指定每月的第几天
          currentDate.setMonth(currentDate.getMonth() + interval);
          currentDate.setDate(Math.min(dayOfMonth, new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()));
        } else {
          // 每月同一天
          currentDate.setMonth(currentDate.getMonth() + interval);
        }
        break;

      case 'yearly':
        if (monthOfYear && dayOfMonth) {
          // 指定每年的某月某日
          currentDate.setFullYear(currentDate.getFullYear() + interval);
          currentDate.setMonth(monthOfYear - 1);
          currentDate.setDate(Math.min(dayOfMonth, new Date(currentDate.getFullYear(), monthOfYear, 0).getDate()));
        } else {
          // 每年同一天
          currentDate.setFullYear(currentDate.getFullYear() + interval);
        }
        break;

      default:
        return events;
    }
  }

  return events;
}

/**
 * 解析重复规则字符串
 * @param {string} recurrenceStr - 重复规则字符串
 * @returns {Object} 重复规则对象
 */
function parseRecurrenceRule(recurrenceStr) {
  if (!recurrenceStr) return null;

  try {
    return JSON.parse(recurrenceStr);
  } catch (e) {
    return null;
  }
}

/**
 * 创建重复规则字符串
 * @param {Object} rule - 重复规则对象
 * @returns {string} 重复规则字符串
 */
function createRecurrenceRule(rule) {
  return JSON.stringify(rule);
}

/**
 * 检查日期是否符合重复规则
 * @param {Date} date - 要检查的日期
 * @param {Object} recurrence - 重复规则
 * @param {Date} startDate - 事件开始日期
 * @returns {boolean} 是否符合
 */
function matchesRecurrenceRule(date, recurrence, startDate) {
  if (!recurrence || !recurrence.type) return false;

  const { type, interval = 1, daysOfWeek = [], dayOfMonth, monthOfYear } = recurrence;

  switch (type) {
    case 'daily':
      return true;

    case 'weekly':
      if (daysOfWeek.length > 0) {
        return daysOfWeek.includes(date.getDay());
      }
      // 计算周数间隔
      const weekDiff = Math.floor((date - startDate) / (7 * 24 * 60 * 60 * 1000));
      return weekDiff % interval === 0;

    case 'monthly':
      if (dayOfMonth) {
        return date.getDate() === dayOfMonth;
      }
      const monthDiff = (date.getFullYear() - startDate.getFullYear()) * 12 +
                       (date.getMonth() - startDate.getMonth());
      return monthDiff % interval === 0 && date.getDate() === startDate.getDate();

    case 'yearly':
      if (monthOfYear && dayOfMonth) {
        return date.getMonth() + 1 === monthOfYear && date.getDate() === dayOfMonth;
      }
      const yearDiff = date.getFullYear() - startDate.getFullYear();
      return yearDiff % interval === 0 &&
             date.getMonth() === startDate.getMonth() &&
             date.getDate() === startDate.getDate();

    default:
      return false;
  }
}

module.exports = {
  generateRecurringEvents,
  parseRecurrenceRule,
  createRecurrenceRule,
  matchesRecurrenceRule
};
