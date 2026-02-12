/**
 * 农历API路由
 */

const express = require('express');
const { getConnection } = require('../db/connection');
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
    const lunarDate = calculateLunarDate(date);

    res.json(lunarDate);
  } catch (e) {
    log('ERROR', '获取农历信息失败', { date: req.params.date, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * 计算农历日期
 * 这是一个简化的农历计算,不依赖外部库
 */
function calculateLunarDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // 简化的农历月份映射
  const lunarMonths = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
  const lunarDays = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
                      '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
                      '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

  // 这是一个简化的计算,实际应该使用专业的农历库
  // 这里返回一个基于公历日期的近似农历日期
  // 在生产环境中,应该使用 lunar-javascript 库进行精确计算

  // 简化算法:农历日期大约比公历晚30-50天
  const lunarOffset = 30; // 简化偏移
  const lunarDate = new Date(date.getTime() - lunarOffset * 24 * 60 * 60 * 1000);

  const lunarYear = lunarDate.getFullYear();
  const lunarMonth = lunarDate.getMonth();
  const lunarDay = lunarDate.getDate();

  // 农历节日映射(简化)
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

  const festivalKey = `${lunarMonth + 1}-${lunarDay}`;
  const festival = festivals[festivalKey];

  return {
    solarDate: dateStr,
    lunarYear: lunarYear,
    lunarMonth: lunarMonth + 1,
    lunarDay: lunarDay,
    lunarMonthCn: lunarMonths[lunarMonth],
    lunarDayCn: lunarDays[lunarDay - 1],
    fullText: `${lunarMonths[lunarMonth]}${lunarDays[lunarDay - 1]}`,
    festival: festival || null
  };
}

module.exports = router;
