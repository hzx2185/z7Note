/**
 * 联系人 API 路由
 */

const express = require('express');
const log = require('../utils/logger');
const contactService = require('../services/contactService');
const { requirePlanCapability } = require('../middleware/memberAccess');

const router = express.Router();

router.use(requirePlanCapability('contactsEnabled', { message: '当前套餐未开启通讯录功能' }));

function getItemQuotaErrorMessage(error) {
  if (error?.message !== 'ITEM_QUOTA_EXCEEDED') return '';
  return `${error.label || '内容'}数量已达套餐上限 (${error.current || 0} / ${error.limit || 0})`;
}

router.get('/', async (req, res) => {
  try {
    const result = await contactService.listContacts(req.user, req.query || {});
    res.json(result);
  } catch (error) {
    log('ERROR', '获取联系人失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '获取失败' });
  }
});

router.get('/duplicates', async (req, res) => {
  try {
    res.json(await contactService.findDuplicateContacts(req.user));
  } catch (error) {
    log('ERROR', '查找重复联系人失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '查找失败' });
  }
});

router.get('/smart-duplicates', async (req, res) => {
  try {
    res.json(await contactService.findSmartDuplicates(req.user));
  } catch (error) {
    log('ERROR', '智能查重失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '查重失败' });
  }
});

router.post('/', async (req, res) => {
  try {
    const result = await contactService.createContact(req.user, req.body || {});
    log('INFO', '创建联系人成功', { username: req.user, contactId: result.id, fn: result.fn });
    res.status(201).json({ id: result.id, message: '创建成功' });
  } catch (error) {
    if (error.message === 'EMPTY_NAME') {
      return res.status(400).json({ error: '姓名不能为空' });
    }
    if (error.message === 'ITEM_QUOTA_EXCEEDED') {
      return res.status(403).json({ error: getItemQuotaErrorMessage(error) });
    }
    log('ERROR', '创建联系人失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '创建失败' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await contactService.updateContact(req.user, req.params.id, req.body || {});
    log('INFO', '更新联系人成功', { username: req.user, contactId: req.params.id });
    res.json({ message: '更新成功' });
  } catch (error) {
    if (error.message === 'EMPTY_NAME') {
      return res.status(400).json({ error: '姓名不能为空' });
    }
    if (error.message === 'CONTACT_NOT_FOUND') {
      return res.status(404).json({ error: '联系人不存在' });
    }
    log('ERROR', '更新联系人失败', { username: req.user, contactId: req.params.id, error: error.message });
    res.status(500).json({ error: '更新失败' });
  }
});

router.post('/format', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    const result = await contactService.formatContacts(req.user, ids);
    log('INFO', '批量格式化联系人完成', { username: req.user, ...result });
    res.json({
      message: result.updatedCount > 0 ? `已格式化 ${result.updatedCount} 个联系人` : '联系人已是规范格式',
      updatedCount: result.updatedCount,
      total: result.total
    });
  } catch (error) {
    log('ERROR', '批量格式化联系人失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '格式化失败' });
  }
});

router.post('/batch-update', async (req, res) => {
  try {
    const result = await contactService.batchUpdateContacts(req.user, req.body || {});
    log('INFO', '批量修改联系人成功', { username: req.user, updatedCount: result.updatedCount });
    res.json(result);
  } catch (error) {
    if (error.message === 'EMPTY_SELECTION') {
      return res.status(400).json({ error: '请先选择要修改的联系人' });
    }
    if (error.message === 'CONTACTS_NOT_FOUND') {
      return res.status(404).json({ error: '未找到可修改的联系人' });
    }
    if (error.message === 'EMPTY_OPERATIONS') {
      return res.status(400).json({ error: '请至少提供一条批量修改规则' });
    }
    if (error.message === 'UNSUPPORTED_BATCH_FIELD') {
      return res.status(400).json({ error: '存在不支持批量修改的字段' });
    }
    if (error.message === 'UNSUPPORTED_BATCH_MODE') {
      return res.status(400).json({ error: '存在不支持的批量修改方式' });
    }
    if (error.message === 'REPLACE_FROM_REQUIRED') {
      return res.status(400).json({ error: '替换模式必须提供原内容' });
    }
    if (error.message === 'BATCH_VALUE_REQUIRED') {
      return res.status(400).json({ error: '请填写要写入的新内容' });
    }
    log('ERROR', '批量修改联系人失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '批量修改失败' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await contactService.deleteContact(req.user, req.params.id);
    log('INFO', '删除联系人成功', { username: req.user, contactId: req.params.id });
    res.json({ message: '删除成功' });
  } catch (error) {
    if (error.message === 'CONTACT_NOT_FOUND') {
      return res.status(404).json({ error: '联系人不存在' });
    }
    log('ERROR', '删除联系人失败', { username: req.user, contactId: req.params.id, error: error.message });
    res.status(500).json({ error: '删除失败' });
  }
});

router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择要删除的联系人' });
    }
    const result = await contactService.deleteContactsBatch(req.user, ids);
    log('INFO', '批量删除联系人成功', { username: req.user, count: result.changes });
    res.json({ message: `成功删除 ${result.changes} 个联系人`, count: result.changes });
  } catch (error) {
    log('ERROR', '批量删除联系人失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '删除失败' });
  }
});

router.post('/merge', async (req, res) => {
  try {
    const { keepId, mergeIds } = req.body || {};
    if (!keepId || !mergeIds || !Array.isArray(mergeIds) || mergeIds.length === 0) {
      return res.status(400).json({ error: '参数错误' });
    }
    const result = await contactService.mergeContacts(req.user, keepId, mergeIds);
    log('INFO', '合并联系人成功', { username: req.user, keepId, ...result });
    res.json({ message: `成功合并 ${result.mergedCount} 个联系人`, ...result });
  } catch (error) {
    if (error.message === 'CONTACT_NOT_FOUND') {
      return res.status(404).json({ error: '联系人不存在' });
    }
    log('ERROR', '合并联系人失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '合并失败' });
  }
});

router.post('/merge-batch', async (req, res) => {
  try {
    const { mergeList } = req.body || {};
    if (!mergeList || !Array.isArray(mergeList) || mergeList.length === 0) {
      return res.status(400).json({ error: '参数错误' });
    }
    const result = await contactService.mergeContactsBatch(req.user, mergeList);
    log('INFO', '批量合并联系人成功', { username: req.user, ...result });
    res.json({ message: `成功合并 ${result.mergedCount} 个联系人`, ...result });
  } catch (error) {
    log('ERROR', '批量合并联系人失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '合并失败' });
  }
});

router.get('/export/:id', requirePlanCapability('importExport', { message: '当前套餐未开启导出功能' }), async (req, res) => {
  try {
    const result = await contactService.exportContact(req.user, req.params.id);
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
    res.send(result.vcard);
  } catch (error) {
    if (error.message === 'CONTACT_NOT_FOUND') {
      return res.status(404).json({ error: '联系人不存在' });
    }
    log('ERROR', '导出联系人失败', { username: req.user, contactId: req.params.id, error: error.message });
    res.status(500).json({ error: '导出失败' });
  }
});

router.get('/export', requirePlanCapability('importExport', { message: '当前套餐未开启导出功能' }), async (req, res) => {
  try {
    const result = await contactService.exportAllContacts(req.user);
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
    res.send(result.vcard);
  } catch (error) {
    log('ERROR', '导出联系人失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '导出失败' });
  }
});

router.post('/import', requirePlanCapability('importExport', { message: '当前套餐未开启导入功能' }), async (req, res) => {
  const startTime = Date.now();
  try {
    const { vcard } = req.body || {};
    if (!vcard) {
      return res.status(400).json({ error: 'vCard 内容不能为空' });
    }

    const result = await contactService.importContacts(req.user, vcard);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    log('INFO', '批量导入联系人成功', {
      username: req.user,
      total: result.total,
      imported: result.count,
      skipped: result.skipped,
      elapsed: `${elapsed}s`
    });

    res.status(201).json({
      message: `成功导入 ${result.count} 个联系人${result.skipped > 0 ? `，跳过 ${result.skipped} 个重复联系人` : ''}`,
      ...result,
      elapsed: `${elapsed}s`
    });
  } catch (error) {
    if (error.message === 'EMPTY_IMPORT_DATA') {
      return res.status(400).json({ error: '未找到有效的联系人数据' });
    }
    if (error.message === 'ITEM_QUOTA_EXCEEDED') {
      return res.status(403).json({ error: getItemQuotaErrorMessage(error) });
    }
    log('ERROR', '导入联系人失败', { username: req.user, error: error.message, stack: error.stack });
    res.status(500).json({ error: '导入失败: ' + error.message });
  }
});

router.get('/:id/history', async (req, res) => {
  try {
    res.json(await contactService.getContactHistory(req.user, req.params.id));
  } catch (error) {
    log('ERROR', '获取历史记录失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '获取失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    res.json(await contactService.getContactDetail(req.user, req.params.id));
  } catch (error) {
    if (error.message === 'CONTACT_NOT_FOUND') {
      return res.status(404).json({ error: '联系人不存在' });
    }
    log('ERROR', '获取联系人失败', { username: req.user, contactId: req.params.id, error: error.message });
    res.status(500).json({ error: '获取失败' });
  }
});

module.exports = router;
