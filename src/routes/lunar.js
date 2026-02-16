/**
 * 农历API路由
 */

const express = require('express');
const { solarToLunar, getLunarFestival } = require('../utils/lunarHelper');
const log = require('../utils/logger');

const router = express.Router();

/**
 * 获取指定日期的农历信息
 * GET /api/lunar/:date
 * date格式: YYYY-MM-DD
 */
router.get('/:date', async (req, res) => {
  try {
    const dateStr = req.params.date;

    // 验证日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: '无效的日期格式' });
    }

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: '无效的日期' });
    }

    // 计算农历日期
    const lunarInfo = solarToLunar(date);
    const festivalInfo = getLunarFestival(date);

    const result = {
      solarDate: dateStr,
      lunarYear: lunarInfo.year,
      lunarMonth: lunarInfo.month,
      lunarDay: lunarInfo.day,
      isLeapMonth: lunarInfo.isLeapMonth,
      lunarYearCn: lunarInfo.yearCn,
      lunarMonthCn: lunarInfo.monthCn,
      lunarDayCn: lunarInfo.dayCn,
      fullText: lunarInfo.fullText,
      festival: festivalInfo ? festivalInfo.name : null
    };

    res.json(result);
  } catch (e) {
    log('ERROR', '获取农历信息失败', { date: req.params.date, error: e.message, stack: e.stack });
    res.status(500).json({ error: '获取失败', message: e.message });
  }
});

/**
 * 批量获取农历信息
 * GET /api/lunar/month/:year/:month
 * year格式: YYYY
 * month格式: MM (01-12)
 */
router.get('/month/:year/:month', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: '无效的年份或月份' });
    }

    const results = {};
    const lastDay = new Date(year, month, 0).getDate();

    for (let day = 1; day <= lastDay; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const date = new Date(year, month - 1, day);

      try {
        const lunarInfo = solarToLunar(date);
        const festivalInfo = getLunarFestival(date);

        results[dateStr] = {
          lunarYear: lunarInfo.year,
          lunarMonth: lunarInfo.month,
          lunarDay: lunarInfo.day,
          isLeapMonth: lunarInfo.isLeapMonth,
          lunarYearCn: lunarInfo.yearCn,
          lunarMonthCn: lunarInfo.monthCn,
          lunarDayCn: lunarInfo.dayCn,
          fullText: lunarInfo.fullText,
          festival: festivalInfo ? festivalInfo.name : null
        };
      } catch (error) {
        console.error('计算农历失败:', dateStr, error);
        results[dateStr] = null;
      }
    }

    res.json(results);
  } catch (e) {
    log('ERROR', '批量获取农历信息失败', { year: req.params.year, month: req.params.month, error: e.message, stack: e.stack });
    res.status(500).json({ error: '获取失败', message: e.message });
  }
});

module.exports = router;
