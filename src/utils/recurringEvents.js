/**
 * 重复事件工具函数
 */

const { generateLunarRecurringEvents } = require('./lunarHelper');

function getUtcMonthDays(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

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
  const masterStartDate = new Date(startTime * 1000);
  masterStartDate.setUTCHours(0, 0, 0, 0);
  const masterDayOfMonth = masterStartDate.getUTCDate();
  const masterMonthOfYear = masterStartDate.getUTCMonth() + 1;

  // 重复结束日期
  const endRecurrenceDate = recurrenceEnd ? new Date(recurrenceEnd * 1000) : new Date(endDate * 1000);
  endRecurrenceDate.setUTCHours(23, 59, 59, 999);

  // 生成重复事件
  let currentDate = new Date(startTime * 1000);
  currentDate.setUTCHours(0, 0, 0, 0);

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
        currentDate.setUTCDate(currentDate.getUTCDate() + interval);
        break;

      case 'weekly':
        if (daysOfWeek.length > 0) {
          // 指定周几重复
          const currentDay = currentDate.getUTCDay();
          let nextDay = daysOfWeek.find(d => d > currentDay);
          if (nextDay === undefined) {
            // 下一周
            nextDay = daysOfWeek[0];
            currentDate.setUTCDate(currentDate.getUTCDate() + (7 - currentDay + nextDay));
          } else {
            currentDate.setUTCDate(currentDate.getUTCDate() + (nextDay - currentDay));
          }
        } else {
          // 每周重复
          currentDate.setUTCDate(currentDate.getUTCDate() + (7 * interval));
        }
        break;

      case 'monthly':
        if (dayOfMonth) {
          // 指定每月的第几天
          currentDate.setUTCMonth(currentDate.getUTCMonth() + interval, 1);
          currentDate.setUTCDate(Math.min(dayOfMonth, getUtcMonthDays(currentDate.getUTCFullYear(), currentDate.getUTCMonth())));
        } else {
          // 每月同一天，固定锚在主事件的日，避免 31 号等边界不断漂移
          currentDate.setUTCMonth(currentDate.getUTCMonth() + interval, 1);
          currentDate.setUTCDate(Math.min(masterDayOfMonth, getUtcMonthDays(currentDate.getUTCFullYear(), currentDate.getUTCMonth())));
        }
        break;

      case 'yearly':
        if (monthOfYear && dayOfMonth) {
          // 指定每年的某月某日
          currentDate.setUTCFullYear(currentDate.getUTCFullYear() + interval, monthOfYear - 1, 1);
          currentDate.setUTCDate(Math.min(dayOfMonth, getUtcMonthDays(currentDate.getUTCFullYear(), monthOfYear - 1)));
        } else {
          // 每年同一天，固定锚在主事件原始月/日
          currentDate.setUTCFullYear(currentDate.getUTCFullYear() + interval, masterMonthOfYear - 1, 1);
          currentDate.setUTCDate(Math.min(masterDayOfMonth, getUtcMonthDays(currentDate.getUTCFullYear(), masterMonthOfYear - 1)));
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
        return daysOfWeek.includes(date.getUTCDay());
      }
      // 计算周数间隔
      const weekDiff = Math.floor((date - startDate) / (7 * 24 * 60 * 60 * 1000));
      return weekDiff % interval === 0;

    case 'monthly':
      if (dayOfMonth) {
        return date.getUTCDate() === dayOfMonth;
      }
      const monthDiff = (date.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
                       (date.getUTCMonth() - startDate.getUTCMonth());
      return monthDiff % interval === 0 && date.getUTCDate() === startDate.getUTCDate();

    case 'yearly':
      if (monthOfYear && dayOfMonth) {
        return date.getUTCMonth() + 1 === monthOfYear && date.getUTCDate() === dayOfMonth;
      }
      const yearDiff = date.getUTCFullYear() - startDate.getUTCFullYear();
      return yearDiff % interval === 0 &&
             date.getUTCMonth() === startDate.getUTCMonth() &&
             date.getUTCDate() === startDate.getUTCDate();

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
