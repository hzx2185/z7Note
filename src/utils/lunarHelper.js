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
    isLeapMonth: false, // lunar-javascript库将闰月作为单独月份处理,不需要判断
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
 * @param {boolean} isLeapMonth - 是否闰月(暂不支持)
 * @returns {Date} 公历日期
 */
function lunarToSolar(year, month, day, isLeapMonth = false) {
  const lunar = Lunar.fromYmd(year, month, day);
  const solar = lunar.getSolar();
  return new Date(solar.toYmd());
}

/**
 * 获取指定公历日期所在农历年的下一个相同农历日期
 * @param {Date} solarDate - 公历日期
 * @returns {Date} 下一年的公历日期
 */
function getNextLunarDate(solarDate) {
  const lunarInfo = solarToLunar(solarDate);
  const nextYear = lunarInfo.year + 1;

  const nextLunar = Lunar.fromYmd(nextYear, lunarInfo.month, lunarInfo.day);
  const nextSolar = nextLunar.getSolar();
  return new Date(nextSolar.toYmd());
}

/**
 * 获取指定公历日期所在农历月的下一个相同农历日期
 * @param {Date} solarDate - 公历日期
 * @returns {Date} 下一月的公历日期
 */
function getNextLunarMonthDate(solarDate) {
  const lunarInfo = solarToLunar(solarDate);

  // 计算下一个农历月
  let nextMonth = lunarInfo.month + 1;
  let nextYear = lunarInfo.year;

  // 如果超过12月,进入下一年
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  const targetLunar = Lunar.fromYmd(nextYear, nextMonth, lunarInfo.day);
  const targetSolar = targetLunar.getSolar();
  return new Date(targetSolar.toYmd());
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
  let recurrence = masterEvent.recurrence;

  if (typeof recurrence === 'string') {
    try {
      recurrence = JSON.parse(recurrence);
    } catch (e) {
      return events;
    }
  }

  if (!recurrence || !recurrence.type || !recurrence.type.startsWith('lunar_')) {
    return events;
  }

  const recurrenceType = recurrence.type; // 'lunar_yearly', 'lunar_monthly'
  const startSolarDate = new Date(masterEvent.startTime * 1000);
  const endRecurrenceDate = masterEvent.recurrenceEnd 
    ? new Date(masterEvent.recurrenceEnd * 1000) 
    : new Date(endDate * 1000);
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
