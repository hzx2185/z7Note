/**
 * 统一时间戳处理工具
 * 确保所有时间戳都使用一致的时区处理逻辑
 */

/**
 * 将本地日期时间转换为Unix秒级时间戳
 * @param {number} year - 年
 * @param {number} month - 月 (0-11)
 * @param {number} day - 日
 * @param {number} hours - 时 (可选)
 * @param {number} minutes - 分 (可选)
 * @param {number} seconds - 秒 (可选)
 * @param {string} timezone - 时区ID (可选，默认为本地时区)
 * @returns {number} Unix秒级时间戳
 */
function localToTimestamp(year, month, day, hours = 0, minutes = 0, seconds = 0, timezone = null) {
  let date;
  
  if (timezone) {
    // 如果指定了时区，使用时区偏移计算
    const offset = getTimezoneOffset(timezone);
    if (offset !== null) {
      // 构造UTC时间戳
      const utcTimestamp = Date.UTC(year, month, day, hours, minutes, seconds);
      // 加上时区偏移得到本地时间对应的UTC时间
      date = new Date(utcTimestamp + (offset * 60 * 60 * 1000));
    } else {
      // 无法识别时区，使用本地时间
      date = new Date(year, month, day, hours, minutes, seconds);
    }
  } else {
    // 使用本地时间
    date = new Date(year, month, day, hours, minutes, seconds);
  }
  
  return Math.floor(date.getTime() / 1000);
}

/**
 * 将UTC日期时间转换为Unix秒级时间戳
 * @param {number} year - 年
 * @param {number} month - 月 (0-11)
 * @param {number} day - 日
 * @param {number} hours - 时 (可选)
 * @param {number} minutes - 分 (可选)
 * @param {number} seconds - 秒 (可选)
 * @returns {number} Unix秒级时间戳
 */
function utcToTimestamp(year, month, day, hours = 0, minutes = 0, seconds = 0) {
  return Math.floor(Date.UTC(year, month, day, hours, minutes, seconds) / 1000);
}

/**
 * 获取时区偏移（小时）
 * @param {string} timezone - 时区ID
 * @returns {number|null} 时区偏移（小时），如果无法识别则返回null
 */
function getTimezoneOffset(timezone) {
  const timezoneMap = {
    'Asia/Shanghai': 8,
    'Asia/Chongqing': 8,
    'Asia/Hong_Kong': 8,
    'Asia/Taipei': 8,
    'Asia/Singapore': 8,
    'Asia/Tokyo': 9,
    'Asia/Seoul': 9,
    'America/New_York': -5,
    'America/Los_Angeles': -8,
    'America/Chicago': -6,
    'Europe/London': 0,
    'Europe/Paris': 1,
    'Europe/Berlin': 1,
    'Australia/Sydney': 10,
    'Pacific/Auckland': 12
  };
  
  // 标准化时区名称
  const normalizedTimezone = timezone.split('/').map(part => 
    part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
  ).join('/');
  
  return timezoneMap[normalizedTimezone] !== undefined ? timezoneMap[normalizedTimezone] : null;
}

/**
 * 验证时间戳是否合理
 * @param {number} timestamp - Unix秒级时间戳
 * @returns {boolean} 是否合理
 */
function isValidTimestamp(timestamp) {
  // 检查是否为10位数字
  if (!Number.isInteger(timestamp) || timestamp.toString().length !== 10) {
    return false;
  }
  
  // 检查是否在合理范围内（2020-2030年）
  const year = new Date(timestamp * 1000).getFullYear();
  return year >= 2020 && year <= 2030;
}

/**
 * 修复错误的时间戳
 * @param {number} timestamp - 可能错误的时间戳
 * @returns {number} 修复后的时间戳
 */
function fixTimestamp(timestamp) {
  const str = timestamp.toString();
  
  // 如果是7位，补全后3位为000
  if (str.length === 7) {
    return parseInt(str + '000');
  }
  
  // 如果是8位，补全后2位为00
  if (str.length === 8) {
    return parseInt(str + '00');
  }
  
  // 如果是9位，补全后1位为0
  if (str.length === 9) {
    return parseInt(str + '0');
  }
  
  // 如果是13位（毫秒），转换为秒
  if (str.length === 13) {
    return Math.floor(timestamp / 1000);
  }
  
  return timestamp;
}

module.exports = {
  localToTimestamp,
  utcToTimestamp,
  getTimezoneOffset,
  isValidTimestamp,
  fixTimestamp
};
