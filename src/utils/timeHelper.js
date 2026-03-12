/**
 * 统一时间处理工具
 */

class TimeHelper {
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
