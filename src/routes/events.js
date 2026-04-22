const express = require('express');
const log = require('../utils/logger');
const { broadcast } = require('./ws');
const eventService = require('../services/eventService');
const { requirePlanCapability } = require('../middleware/memberAccess');

const router = express.Router();

router.use(requirePlanCapability('calendarEnabled', { message: '当前套餐未开启日历功能' }));

function getItemQuotaErrorMessage(error) {
  if (error?.message !== 'ITEM_QUOTA_EXCEEDED') return '';
  return `${error.label || '内容'}数量已达套餐上限 (${error.current || 0} / ${error.limit || 0})`;
}

function broadcastCalendarSync(username) {
  broadcast('calendar_update', { username, type: 'sync' }, { targetUsername: username });
}

router.post('/batch', async (req, res) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: '无效的事件数据' });
    }

    const count = await eventService.createBatchEvents(req.user, events);
    broadcastCalendarSync(req.user);
    res.json({ success: true, count });
  } catch (error) {
    if (error.message === 'ITEM_QUOTA_EXCEEDED') {
      return res.status(403).json({ error: getItemQuotaErrorMessage(error) });
    }
    log('ERROR', '批量创建事件失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '批量创建失败' });
  }
});

router.get('/', async (req, res) => {
  try {
    const events = await eventService.listEvents(req.user, req.query.startDate, req.query.endDate);
    res.json(events);
  } catch {
    res.status(500).json({ error: '获取失败' });
  }
});

router.delete('/batch', async (req, res) => {
  try {
    await eventService.deleteBatchEvents(req.user, req.body || {});
    broadcastCalendarSync(req.user);
    res.json({ success: true });
  } catch (error) {
    if (error.message === 'INVALID_DELETE_REQUEST') {
      return res.status(400).json({ error: '无效的删除请求' });
    }
    res.status(500).json({ error: '批量删除失败: ' + error.message });
  }
});

router.get('/expand-lunar', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '缺少范围参数' });
    }

    const expanded = await eventService.expandLunarEvents(
      req.user,
      parseInt(startDate, 10),
      parseInt(endDate, 10)
    );
    res.json(expanded);
  } catch (error) {
    log('ERROR', '批量展开农历事件失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '展开失败' });
  }
});

router.get('/expand-recurring', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '缺少范围参数' });
    }

    const expanded = await eventService.expandRecurringEventsForUser(
      req.user,
      parseInt(startDate, 10),
      parseInt(endDate, 10)
    );
    res.json(expanded);
  } catch (error) {
    log('ERROR', '批量展开重复事件失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '展开失败' });
  }
});

router.post('/format', async (req, res) => {
  try {
    const fixedCount = await eventService.formatUserEvents(req.user);
    broadcastCalendarSync(req.user);
    res.json({ success: true, fixedCount });
  } catch (error) {
    res.status(500).json({ error: '格式化失败: ' + error.message });
  }
});

router.get('/export', requirePlanCapability('importExport', { message: '当前套餐未开启导出功能' }), async (req, res) => {
  try {
    const icsContent = await eventService.exportCalendar(req.user);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="z7note-calendar-${Date.now()}.ics"`);
    res.send(icsContent);
  } catch (error) {
    log('ERROR', '导出日历失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '导出失败: ' + error.message });
  }
});

router.post('/import', requirePlanCapability('importExport', { message: '当前套餐未开启导入功能' }), async (req, res) => {
  try {
    const { icsContent } = req.body;
    if (!icsContent) {
      return res.status(400).json({ error: '缺少 icsContent' });
    }

    const result = await eventService.importCalendar(req.user, icsContent);
    broadcastCalendarSync(req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.message === 'ITEM_QUOTA_EXCEEDED') {
      return res.status(403).json({ error: getItemQuotaErrorMessage(error) });
    }
    log('ERROR', '导入日历失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '导入失败: ' + error.message });
  }
});

router.post('/cleanup-duplicates', async (req, res) => {
  try {
    const result = await eventService.cleanupDuplicateEvents(req.user);
    broadcastCalendarSync(req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    log('ERROR', '清理重复事件失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '清理失败: ' + error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: '标题不能为空' });
    }

    const result = await eventService.createEvent(req.user, req.body);
    broadcastCalendarSync(req.user);
    res.json(result);
  } catch (error) {
    if (error.message === 'INVALID_START_TIME') {
      return res.status(400).json({ error: '开始时间无效' });
    }
    if (error.message === 'ITEM_QUOTA_EXCEEDED') {
      return res.status(403).json({ error: getItemQuotaErrorMessage(error) });
    }
    res.status(500).json({ error: '创建失败' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const result = await eventService.updateEvent(req.user, req.params.id, req.body || {});
    broadcastCalendarSync(req.user);
    res.json(result);
  } catch (error) {
    if (error.message === 'EVENT_NOT_FOUND') {
      return res.status(404).json({ error: '事件不存在' });
    }
    if (error.message === 'INVALID_START_TIME') {
      return res.status(400).json({ error: '开始时间无效' });
    }
    res.status(500).json({ error: '更新失败: ' + error.message });
  }
});

router.post('/:id/delete-scope', async (req, res) => {
  try {
    const result = await eventService.deleteEventScope(req.user, req.params.id, req.body || {});
    broadcastCalendarSync(req.user);
    res.json(result);
  } catch (error) {
    if (error.message === 'EVENT_NOT_FOUND') {
      return res.status(404).json({ error: '事件不存在' });
    }
    if (error.message === 'NOT_RECURRING_EVENT') {
      return res.status(400).json({ error: '这不是重复事件' });
    }
    if (error.message === 'INVALID_DELETE_SCOPE') {
      return res.status(400).json({ error: '删除范围无效' });
    }
    if (error.message === 'MISSING_OCCURRENCE_START') {
      return res.status(400).json({ error: '缺少重复实例时间' });
    }
    res.status(500).json({ error: '删除失败: ' + error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await eventService.deleteEvent(req.user, req.params.id);
    broadcastCalendarSync(req.user);
    res.json(result);
  } catch (error) {
    if (error.message === 'EVENT_NOT_FOUND') {
      return res.status(404).json({ error: '事件不存在' });
    }
    res.status(500).json({ error: '删除失败: ' + error.message });
  }
});

router.get('/calendar/day/:date', async (req, res) => {
  try {
    const result = await eventService.getDayCalendarData(req.user, req.params.date);
    res.json(result);
  } catch {
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const result = await eventService.searchCalendarContent(req.user, req.query.q);
    res.json(result);
  } catch (error) {
    log('ERROR', '搜索失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '搜索失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const event = await eventService.getEventDetail(req.user, req.params.id);
    res.json(event);
  } catch (error) {
    if (error.message === 'EVENT_NOT_FOUND') {
      return res.status(404).json({ error: '事件不存在' });
    }
    res.status(500).json({ error: '获取详情失败' });
  }
});

module.exports = router;
