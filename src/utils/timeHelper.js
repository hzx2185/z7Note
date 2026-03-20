/**
 * 统一时间处理工具
 */

class TimeHelper {
  static getAppTimeZone() {
    return 'Asia/Shanghai';
  }

  static getDatePartsInTimeZone(ts, timeZone = TimeHelper.getAppTimeZone()) {
    if (!ts && ts !== 0) return null;
    const d = new Date(ts * 1000);

    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = formatter.formatToParts(d);
      return {
        year: Number(parts.find(p => p.type === 'year').value),
        month: Number(parts.find(p => p.type === 'month').value),
        day: Number(parts.find(p => p.type === 'day').value)
      };
    } catch (e) {
      return {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate()
      };
    }
  }

  static toUtcMidnightTs(year, month, day) {
    return Math.floor(Date.UTC(year, month - 1, day) / 1000);
  }

  static getUtcDateParts(ts) {
    if (!ts && ts !== 0) return null;
    const d = new Date(ts * 1000);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate()
    };
  }

  static normalizeAllDayRange(startTs, endTs, timeZone = TimeHelper.getAppTimeZone()) {
    if (startTs === undefined || startTs === null || startTs === '') {
      return { startTime: null, endTime: null };
    }

    const normalizedStartTs = TimeHelper.parseToTs(startTs);
    const normalizedEndTs = TimeHelper.parseToTs(endTs);

    if (!normalizedStartTs) {
      return { startTime: null, endTime: null };
    }

    // 全天事件在系统内统一按 UTC 00:00/排他性结束日存储。
    // 这里必须按 UTC 日期归一化，避免 00:00 UTC 在东八区被再次解释成“当天上午”，
    // 从而让保存一次就把结束日期偷偷往后推一天。
    const startParts = TimeHelper.getUtcDateParts(normalizedStartTs);
    const startTime = TimeHelper.toUtcMidnightTs(startParts.year, startParts.month, startParts.day);

    const inclusiveEndSource = normalizedEndTs && normalizedEndTs > normalizedStartTs
      ? normalizedEndTs - 1
      : normalizedStartTs;
    const endParts = TimeHelper.getUtcDateParts(inclusiveEndSource);
    const endTime = TimeHelper.toUtcMidnightTs(endParts.year, endParts.month, endParts.day + 1);

    return { startTime, endTime };
  }

  /**
   * 将任何输入解析为秒级 Unix 时间戳
   */
  static parseToTs(val) {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'number') {
      return val > 100000000000 ? Math.floor(val / 1000) : val;
    }
    const d = new Date(val);
    const ts = d.getTime();
    if (isNaN(ts)) {
      if (/^\d+$/.test(val)) {
        const n = parseInt(val);
        return n > 100000000000 ? Math.floor(n / 1000) : n;
      }
      return null;
    }
    return Math.floor(ts / 1000);
  }

  /**
   * 格式化为 iCal 要求的 UTC 格式 (YYYYMMDDTHHMMSSZ)
   */
  static toIcalUTC(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  /**
    * 格式化为 iCal 要求的日期格式 (YYYYMMDD)
    * 关键：全天事件必须基于“当地意图”的日期，避免 UTC 偏移导致日期跳变
    */
  static toIcalDate(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);

    try {
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: '2-digit', day: '2-digit'
      });
      const parts = formatter.formatToParts(d);
      const y = parts.find(p => p.type === 'year').value;
      const m = parts.find(p => p.type === 'month').value;
      const day = parts.find(p => p.type === 'day').value;
      return `${y}${m}${day}`;
    } catch (e) {
      // 降级使用本地方法
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    }
  }
  /**
   * 前端专用：将时间戳转为 datetime-local 所需的字符串
   * 考虑时区偏移，确保 input 显示的是本地时间
   */
  static toLocalISO(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  }
}

module.exports = TimeHelper;
