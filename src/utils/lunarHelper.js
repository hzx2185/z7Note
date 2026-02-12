/**
 * 农历工具函数
 * 使用 lunar-javascript 库处理中国农历相关功能
 */

const { Lunar, Solar } = require('lunar-javascript');

/**
 * 将公历日期转换为农历日期
 * @param {Date} solarDate - 公历日期
 * @returns {Object} 农历信息
 */
function solarToLunar(solarDate) {
  const solar = Solar.fromDate(solarDate);
  const lunar = solar.getLunar();

  return {
    year: lunar.getYear(),
    month: lunar.getMonth(),
    day: lunar.getDay(),
    isLeapMonth: lunar.isLeap(),
    yearCn: lunar.getYearInChinese(),
    monthCn: lunar.getMonthInChinese(),
    dayCn: lunar.getDayInChinese(),
    fullText: `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}${lunar.getDayInChinese()}`
  };
}

/**
 * 将农历日期转换为公历日期
 * @param {number} year - 农历年
 * @param {number} month - 农历月
 * @param {number} day - 农历日
 * @param {boolean} isLeapMonth - 是否闰月
 * @returns {Date} 公历日期
 */
function lunarToSolar(year, month, day, isLeapMonth = false) {
  const lunar = Lunar.fromYmd(year, month, day, isLeapMonth);
  const solar = lunar.getSolar();
  return solar.toDate();
}

/**
 * 获取指定公历日期所在农历年的下一个相同农历日期
 * @param {Date} solarDate - 公历日期
 * @returns {Date} 下一年的公历日期
 */
function getNextLunarDate(solarDate) {
  const lunarInfo = solarToLunar(solarDate);
  const nextYear = lunarInfo.year + 1;

  // 如果是闰月,需要特殊处理
  if (lunarInfo.isLeapMonth) {
    // 闰月不是每年都有,如果下一年没有该闰月,使用同月
    const nextLunar = Lunar.fromYmd(nextYear, lunarInfo.month, lunarInfo.day, false);
    return nextLunar.getSolar().toDate();
  }

  const nextLunar = Lunar.fromYmd(nextYear, lunarInfo.month, lunarInfo.day);
  return nextLunar.getSolar().toDate();
}

/**
 * 获取指定公历日期所在农历月的下一个相同农历日期
 * @param {Date} solarDate - 公历日期
 * @returns {Date} 下一月的公历日期
 */
function getNextLunarMonthDate(solarDate) {
  const lunarInfo = solarToLunar(solarDate);

  // 如果是闰月,下个月就是下个农历月的初一
  if (lunarInfo.isLeapMonth) {
    const nextLunar = Lunar.fromYmd(lunarInfo.year, lunarInfo.month + 1, lunarInfo.day, false);
    return nextLunar.getSolar().toDate();
  }

  // 检查下个月是否有闰月
  const currentLunar = Lunar.fromYmd(lunarInfo.year, lunarInfo.month, 1);
  const nextMonthLunar = currentLunar.nextMonth();

  // 如果下个月有闰月,且当前月不是闰月,需要跳过闰月
  if (nextMonthLunar.isLeap()) {
    const afterLeapLunar = nextMonthLunar.nextMonth();
    const targetLunar = Lunar.fromYmd(afterLeapLunar.getYear(), afterLeapLunar.getMonth(), lunarInfo.day);
    return targetLunar.getSolar().toDate();
  }

  const targetLunar = Lunar.fromYmd(nextMonthLunar.getYear(), nextMonthLunar.getMonth(), lunarInfo.day);
  return targetLunar.getSolar().toDate();
}

/**
 * 生成农历重复事件
 * @param {Object} masterEvent - 主事件
 * @param {number} startDate - 开始日期(秒时间戳)
 * @param {number} endDate - 结束日期(秒时间戳)
 * @returns {Array} 生成的重复事件列表
 */
function generateLunarRecurringEvents(masterEvent, startDate, endDate) {
  const events = [];
  const { recurrence, recurrenceEnd, startTime } = masterEvent;

  if (!recurrence || !recurrence.type || !recurrence.type.startsWith('lunar_')) {
    return events;
  }

  const recurrenceType = recurrence.type; // 'lunar_yearly', 'lunar_monthly'
  const startSolarDate = new Date(startTime * 1000);
  const endRecurrenceDate = recurrenceEnd ? new Date(recurrenceEnd * 1000) : new Date(endDate * 1000);
  endRecurrenceDate.setHours(23, 59, 59, 999);

  let currentDate = new Date(startSolarDate);
  const maxIterations = 100;
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
        endTime: masterEvent.endTime ? currentTimestamp + (masterEvent.endTime - masterEvent.startTime) : null
      };
      events.push(event);
    }

    // 计算下一个日期
    if (recurrenceType === 'lunar_yearly') {
      currentDate = getNextLunarDate(currentDate);
    } else if (recurrenceType === 'lunar_monthly') {
      currentDate = getNextLunarMonthDate(currentDate);
    }
  }

  return events;
}

/**
 * 检查日期是否是农历节日
 * @param {Date} solarDate - 公历日期
 * @returns {Object|null} 农历节日信息
 */
function getLunarFestival(solarDate) {
  const lunar = solarToLunar(solarDate);

  // 主要农历节日
  const festivals = {
    '1-1': '春节',
    '1-15': '元宵节',
    '2-2': '龙抬头',
    '5-5': '端午节',
    '7-7': '七夕节',
    '7-15': '中元节',
    '8-15': '中秋节',
    '9-9': '重阳节',
    '12-8': '腊八节',
    '12-23': '小年',
    '12-30': '除夕'
  };

  const key = `${lunar.month}-${lunar.day}`;
  const festivalName = festivals[key];

  if (festivalName) {
    return {
      name: festivalName,
      lunarDate: `${lunar.monthCn}${lunar.dayCn}`,
      isLeapMonth: lunar.isLeapMonth
    };
  }

  return null;
}

/**
 * 格式化农历日期显示
 * @param {Date} solarDate - 公历日期
 * @returns {string} 格式化的农历日期
 */
function formatLunarDate(solarDate) {
  const lunar = solarToLunar(solarDate);
  return `${lunar.monthCn}${lunar.dayCn}`;
}

module.exports = {
  solarToLunar,
  lunarToSolar,
  getNextLunarDate,
  getNextLunarMonthDate,
  generateLunarRecurringEvents,
  getLunarFestival,
  formatLunarDate
};
