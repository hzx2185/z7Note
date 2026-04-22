const express = require('express');
const fs = require('fs').promises;
const db = require('../db/client');
const { createBackupArchive } = require('../services/backup');
const { deleteContact, getContactDetail } = require('../services/contactService');
const { insertDeletedItem } = require('../utils/deletedItems');
const { broadcast } = require('./ws');
const {
  getUserStats,
  filterAndSortUserStats,
  deleteUser,
  resetUserPassword,
  updateUserQuota,
  updateUserPlan,
  createUser
} = require('../services/adminUserService');
const {
  createRedeemCode,
  createRedeemCodesBatch,
  listRedeemCodes,
  listRedeemCodeRedemptions,
  listPlanConfigs,
  listMembershipOperations,
  recordMembershipOperation,
  setRedeemCodeEnabled,
  normalizePlanKey,
  adjustUserMembershipDays,
  updatePlanConfigs
} = require('../services/memberService');
const {
  updateAllResources,
  getCDNStatus,
  clearCache,
  getCdnConfig,
  updateCdnConfig,
  getSystemConfigSnapshot,
  updateSystemConfigs,
  resetSystemConfigs,
  initializeDefaultSystemConfig,
  getSmtpConfigSnapshot,
  updateSmtpSettings,
  cleanupUploadSessions
} = require('../services/adminSystemService');
const config = require('../config');
const log = require('../utils/logger');
const { ADMIN_EVENTS } = require('../constants/securityEvents');

const router = express.Router();

function normalizeWorkspaceType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['all', 'note', 'event', 'todo', 'contact'].includes(type) ? type : 'all';
}

function buildWorkspaceOverviewQuery() {
  return `
    SELECT username, type, itemCount, lastUpdatedAt FROM (
      SELECT username, 'note' AS type, COUNT(*) AS itemCount, MAX(updatedAt) AS lastUpdatedAt
      FROM notes
      GROUP BY username
      UNION ALL
      SELECT username, 'event' AS type, COUNT(*) AS itemCount, MAX(updatedAt) AS lastUpdatedAt
      FROM events
      GROUP BY username
      UNION ALL
      SELECT username, 'todo' AS type, COUNT(*) AS itemCount, MAX(updatedAt) AS lastUpdatedAt
      FROM todos
      GROUP BY username
      UNION ALL
      SELECT username, 'contact' AS type, COUNT(*) AS itemCount, MAX(updatedAt) AS lastUpdatedAt
      FROM contacts
      GROUP BY username
    ) AS workspace_overview
  `;
}

async function deleteWorkspaceItem(type, id, username, deletedBy) {
  const now = Math.floor(Date.now() / 1000);

  if (type === 'note') {
    const result = await db.execute('DELETE FROM notes WHERE id = ? AND username = ?', [id, username]);
    if (!result.changes) throw new Error('WORKSPACE_ITEM_NOT_FOUND');
    log('INFO', '管理员删除工作区笔记', { type, id, username, deletedBy });
    return;
  }

  if (type === 'event') {
    const existing = await db.queryOne('SELECT id FROM events WHERE id = ? AND username = ?', [id, username]);
    if (!existing) throw new Error('WORKSPACE_ITEM_NOT_FOUND');
    await insertDeletedItem(db, {
      username,
      itemId: existing.id,
      type: 'event',
      deletedAt: now
    });
    await db.execute('DELETE FROM events WHERE id = ? AND username = ?', [existing.id, username]);
    broadcast('calendar_update', { username, type: 'sync' }, { username });
    log('INFO', '管理员删除工作区事件', { type, id, username, deletedBy });
    return;
  }

  if (type === 'todo') {
    const existing = await db.queryOne('SELECT id FROM todos WHERE id = ? AND username = ?', [id, username]);
    if (!existing) throw new Error('WORKSPACE_ITEM_NOT_FOUND');
    await insertDeletedItem(db, {
      username,
      itemId: existing.id,
      type: 'todo',
      deletedAt: now
    });
    await db.execute('DELETE FROM todos WHERE id = ? AND username = ?', [existing.id, username]);
    broadcast('calendar_update', { username, type: 'sync' }, { username });
    log('INFO', '管理员删除工作区待办', { type, id, username, deletedBy });
    return;
  }

  if (type === 'contact') {
    await deleteContact(username, id);
    log('INFO', '管理员删除工作区联系人', { type, id, username, deletedBy });
    return;
  }

  throw new Error('INVALID_WORKSPACE_TYPE');
}

async function getWorkspaceItemDetail(type, id, username) {
  if (type === 'note') {
    const note = await db.queryOne(
      'SELECT id, username, title, content, createdAt, updatedAt, deleted FROM notes WHERE id = ? AND username = ?',
      [id, username]
    );
    if (!note) throw new Error('WORKSPACE_ITEM_NOT_FOUND');
    return {
      type,
      id: note.id,
      username: note.username,
      title: note.title || '',
      status: note.deleted ? '回收站' : '活跃',
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      detail: {
        content: note.content || ''
      }
    };
  }

  if (type === 'event') {
    const event = await db.queryOne(
      `SELECT id, username, title, description, startTime, endTime, allDay, color, recurrence, createdAt, updatedAt
       FROM events WHERE id = ? AND username = ?`,
      [id, username]
    );
    if (!event) throw new Error('WORKSPACE_ITEM_NOT_FOUND');
    return {
      type,
      id: event.id,
      username: event.username,
      title: event.title || '',
      status: event.recurrence ? '重复事件' : (event.allDay ? '全天事件' : '日程事件'),
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      detail: {
        description: event.description || '',
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: !!event.allDay,
        color: event.color || '',
        recurrence: event.recurrence || ''
      }
    };
  }

  if (type === 'todo') {
    const todo = await db.queryOne(
      `SELECT id, username, title, description, completed, priority, dueDate, startTime, allDay, createdAt, updatedAt
       FROM todos WHERE id = ? AND username = ?`,
      [id, username]
    );
    if (!todo) throw new Error('WORKSPACE_ITEM_NOT_FOUND');
    return {
      type,
      id: todo.id,
      username: todo.username,
      title: todo.title || '',
      status: todo.completed ? '已完成' : '待处理',
      createdAt: todo.createdAt,
      updatedAt: todo.updatedAt,
      detail: {
        description: todo.description || '',
        completed: !!todo.completed,
        priority: todo.priority,
        dueDate: todo.dueDate,
        startTime: todo.startTime,
        allDay: !!todo.allDay
      }
    };
  }

  if (type === 'contact') {
    const contact = await getContactDetail(username, id);
    return {
      type,
      id: contact.id,
      username: contact.username,
      title: contact.fn || '',
      status: contact.org ? `联系人 / ${contact.org}` : '联系人',
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      detail: {
        org: contact.org || '',
        jobTitle: contact.title || '',
        nickname: contact.nickname || '',
        bday: contact.bday || '',
        url: contact.url || '',
        tel: contact.tel || '',
        email: contact.email || '',
        note: contact.note || ''
      }
    };
  }

  throw new Error('INVALID_WORKSPACE_TYPE');
}

// 更新备份配置
router.post('/api/admin/backup/config', async (req, res) => {
  try {
    const { updateBackupConfig } = require('../services/backup');
    await updateBackupConfig(req.body);
    res.json({ status: "ok" });
  } catch (e) {
    log('ERROR', '保存备份配置失败', { error: e.message, stack: e.stack, updatedBy: req.user });
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

// 获取备份配置
router.get('/api/admin/backup/config', async (req, res) => { 
  res.json(await db.queryOne('SELECT * FROM backup_config WHERE id = 1') || {}); 
});

// 下载全量备份
router.get('/api/admin/backup/download-full', async (req, res) => { 
  const { filePath, fileName } = await createBackupArchive(false); 
  res.download(filePath, fileName); 
});

// 下载增量备份
router.get('/api/admin/backup/download-inc', async (req, res) => { 
  const { filePath, fileName } = await createBackupArchive(true); 
  res.download(filePath, fileName); 
});

// 获取备份列表
router.get('/api/admin/backup/list', async (req, res) => {
  const { getBackupList } = require('../services/backup');
  res.json(await getBackupList());
});

// 立即备份
router.post('/api/admin/backup/now', async (req, res) => {
  try {
    const { performBackup } = require('../services/backup');
    const backupConfig = await db.queryOne('SELECT * FROM backup_config WHERE id = 1') || {};
    if (!backupConfig.schedule) {
      return res.status(400).json({ error: '请先配置备份选项' });
    }
    await performBackup(backupConfig);
    res.json({ status: 'ok', message: '备份已执行' });
  } catch (e) {
    log('ERROR', '立即备份失败', { error: e.message, stack: e.stack, triggeredBy: req.user });
    res.status(500).json({ error: '备份失败: ' + e.message });
  }
});

// 获取用户统计
router.get('/api/admin/users/stats', async (req, res) => {
  try {
    const { search, sort, order } = req.query;
    const stats = filterAndSortUserStats(await getUserStats(), { search, sort, order });
    res.json(stats);
  } catch (e) { 
    log('ERROR', '获取用户统计失败', { error: e.message, stack: e.stack, requestedBy: req.user });
    res.status(500).json({ error: "Stats failed" }); 
  }
});

// 删除用户
router.delete('/api/admin/users/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const user = await deleteUser(username);
    if (!user) {
      log('WARN', '管理员删除用户目标不存在', {
        event: ADMIN_EVENTS.USER_DELETE_NOT_FOUND,
        username,
        requestedBy: req.user
      });
      return res.status(404).json({ error: "用户不存在" });
    }

    log('INFO', '管理员删除用户', {
      event: ADMIN_EVENTS.USER_DELETE_SUCCESS,
      username,
      deletedBy: req.user
    });
    res.json({ status: "ok" });
  } catch (e) {
    log('ERROR', '管理员删除用户失败', {
      event: ADMIN_EVENTS.USER_DELETE_FAILED,
      username,
      deletedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: "删除失败" }); 
  }
});

// 重置用户密码
router.post('/api/admin/users/reset-password', async (req, res) => {
  const { username, newPassword } = req.body;
  const updated = await resetUserPassword(username, newPassword);
  if (!updated) {
    log('WARN', '管理员重置密码目标不存在', {
      event: ADMIN_EVENTS.USER_PASSWORD_RESET_NOT_FOUND,
      username,
      resetBy: req.user
    });
    return res.status(404).json({ error: "用户不存在" });
  }
  log('INFO', '管理员重置用户密码', {
    event: ADMIN_EVENTS.USER_PASSWORD_RESET_SUCCESS,
    username,
    resetBy: req.user
  });
  res.json({ status: "ok" });
});

// 更新用户配额
router.post('/api/admin/users/update-quota', async (req, res) => {
  const { username, noteLimit, fileLimit } = req.body;
  try { 
    await updateUserQuota(username, noteLimit, fileLimit);
    log('INFO', '管理员更新用户配额', {
      event: ADMIN_EVENTS.USER_QUOTA_UPDATE_SUCCESS,
      username,
      noteLimit,
      fileLimit,
      updatedBy: req.user
    });
    res.json({ status: "ok" }); 
  } catch (e) {
    log('ERROR', '管理员更新用户配额失败', {
      event: ADMIN_EVENTS.USER_QUOTA_UPDATE_FAILED,
      username,
      updatedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: "Update failed" });
  }
});

router.post('/api/admin/users/update-plan', async (req, res) => {
  const { username, planKey } = req.body;
  const normalizedPlanKey = typeof planKey === 'string' ? planKey.trim().toLowerCase() : '';
  if (!['free', 'pro', 'team'].includes(normalizedPlanKey)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  try {
    const existingUser = await db.queryOne(
      'SELECT username, planKey, noteLimit, fileLimit, planExpiresAt FROM users WHERE username = ?',
      [username]
    );
    if (!existingUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const membership = await updateUserPlan(username, normalizedPlanKey);
    await recordMembershipOperation({
      username,
      action: 'set_plan',
      operator: req.user,
      source: 'admin_plan_update',
      planKey: membership.planKey,
      noteLimit: membership.noteLimit,
      fileLimit: membership.fileLimit,
      planExpiresAt: membership.planExpiresAt,
      details: {
        previousPlanKey: existingUser.planKey,
        previousNoteLimit: existingUser.noteLimit,
        previousFileLimit: existingUser.fileLimit,
        previousPlanExpiresAt: existingUser.planExpiresAt || 0
      }
    });
    res.json({ status: 'ok', membership });
  } catch (e) {
    res.status(500).json({ error: 'Update failed' });
  }
});

router.post('/api/admin/users/adjust-membership', async (req, res) => {
  const { username, deltaDays } = req.body || {};

  try {
    const result = await adjustUserMembershipDays(username, deltaDays, req.user);
    res.json({ status: 'ok', membership: result });
  } catch (error) {
    if (error.message === 'INVALID_MEMBERSHIP_DELTA') {
      return res.status(400).json({ error: '调整天数必须是非 0 整数' });
    }
    if (error.message === 'FREE_PLAN_CANNOT_ADJUST') {
      return res.status(400).json({ error: 'Free 套餐没有会员时长可调整，请先切换到 Pro / Team' });
    }
    if (error.message === 'PERMANENT_PLAN_CANNOT_REDUCE') {
      return res.status(400).json({ error: '长期有效套餐不能直接扣减天数，请先设置有限时会员' });
    }
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.status(500).json({ error: 'Update failed' });
  }
});

router.get('/api/admin/member-plans', async (req, res) => {
  try {
    const plans = await listPlanConfigs();
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load member plans' });
  }
});

router.post('/api/admin/member-plans', async (req, res) => {
  const { plans } = req.body || {};
  if (!plans || typeof plans !== 'object') {
    return res.status(400).json({ error: 'Invalid plans payload' });
  }

  try {
    await updatePlanConfigs(plans);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update member plans' });
  }
});

router.get('/api/admin/membership-operations', async (req, res) => {
  try {
    const items = await listMembershipOperations({
      search: req.query.search || '',
      limit: req.query.limit || 100
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load membership operations' });
  }
});

router.get('/api/admin/redeem-codes', async (req, res) => {
  try {
    const codes = await listRedeemCodes();
    res.json(codes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load redeem codes' });
  }
});

router.get('/api/admin/redeem-codes/redemptions', async (req, res) => {
  try {
    const items = await listRedeemCodeRedemptions({
      search: req.query.search || '',
      limit: req.query.limit || 100
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load redemptions' });
  }
});

router.post('/api/admin/redeem-codes', async (req, res) => {
  const {
    code,
    planKey,
    noteLimit,
    fileLimit,
    durationDays,
    maxRedemptions,
    expiresAt,
    count
  } = req.body || {};

  const rawPlanKey = typeof planKey === 'string' ? planKey.trim().toLowerCase() : '';
  if (!['free', 'pro', 'team'].includes(rawPlanKey)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  const normalizedPlanKey = normalizePlanKey(rawPlanKey);

  try {
    if (Number(count) > 1) {
      const redeemCodes = await createRedeemCodesBatch({
        count,
        planKey: normalizedPlanKey,
        noteLimit,
        fileLimit,
        durationDays,
        maxRedemptions,
        expiresAt,
        createdBy: req.user
      });
      return res.json({ status: 'ok', redeemCodes });
    }

    const redeemCode = await createRedeemCode({
      code,
      planKey: normalizedPlanKey,
      noteLimit,
      fileLimit,
      durationDays,
      maxRedemptions,
      expiresAt,
      createdBy: req.user
    });
    return res.json({ status: 'ok', redeemCode });
  } catch (error) {
    if (error.message === 'REDEEM_CODE_EXISTS') {
      return res.status(400).json({ error: '兑换码已存在' });
    }
    res.status(500).json({ error: 'Create failed' });
  }
});

router.post('/api/admin/redeem-codes/:code/toggle', async (req, res) => {
  const enabled = !!req.body?.enabled;
  try {
    await setRedeemCodeEnabled(req.params.code, enabled);
    res.json({ status: 'ok' });
  } catch (error) {
    if (error.message === 'REDEEM_CODE_NOT_FOUND') {
      return res.status(404).json({ error: '兑换码不存在' });
    }
    res.status(500).json({ error: 'Update failed' });
  }
});

// 添加用户
router.post('/api/admin/users/add', async (req, res) => {
  const { username, password, email } = req.body;
  try { 
    const createdUser = await createUser(username, password, email);
    log('INFO', '管理员添加用户', { username: createdUser.username, email: createdUser.email, addedBy: req.user });
    res.json({ status: "ok" }); 
  } catch (e) {
    if (e.message === 'INVALID_USERNAME') {
      return res.status(400).json({ error: "用户名必须是3-20个字符，只允许字母、数字、下划线" });
    }
    if (e.message === 'INVALID_EMAIL') {
      return res.status(400).json({ error: "邮箱格式不正确" });
    }
    if (e.message === 'INVALID_PASSWORD') {
      return res.status(400).json({ error: "密码至少需要6个字符" });
    }
    if (e.message === 'EMAIL_IN_USE') {
      return res.status(400).json({ error: "邮箱已被其他账户绑定" });
    }
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: "用户名已存在" });
    }
    res.status(400).json({ error: "新增用户失败" });
  }
});

// 清理已删除笔记
router.post('/api/admin/notes/purge', async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const deletedNotes = await db.queryAll('SELECT DISTINCT username FROM notes WHERE deleted = 1');
    for (const user of deletedNotes) {
      await db.execute('UPDATE users SET dataCutoffTime = ? WHERE username = ?', [now, user.username]);
    }
    await db.execute('DELETE FROM notes WHERE deleted = 1');
    await db.maintenance.compact();
    log('INFO', '管理员清理已删除笔记', { purgedBy: req.user, cutoff: now });
    res.json({ status: "ok", message: `已清理并设置拦截点：${new Date(now).toLocaleString()}` });
  } catch (e) { res.status(500).json({ error: "物理清理失败" }); }
});

// 获取所有笔记
router.get('/api/admin/notes/all', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const search = req.query.search || '';
  const offset = (page - 1) * limit;
  let whereClause = '', params = [];
  if (search) { whereClause = ' WHERE username LIKE ? OR title LIKE ?'; params = [`%${search}%`, `%${search}%`]; }
  const countRes = await db.queryOne(`SELECT COUNT(*) as total FROM notes ${whereClause}`, params);
  const notes = await db.queryAll(
    `SELECT * FROM notes ${whereClause} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`, 
    [...params, limit, offset]
  );
  res.json({ total: countRes.total, page, totalPages: Math.ceil(countRes.total / limit), notes });
});

router.get('/api/admin/workspace/all', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 100);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const type = normalizeWorkspaceType(req.query.type);
    const offset = (page - 1) * limit;

    const sources = [
      {
        key: 'note',
        sql: `SELECT id, username, title, updatedAt, createdAt,
              CASE WHEN deleted = 1 THEN '回收站' ELSE '活跃' END AS status,
              substr(COALESCE(content, ''), 1, 140) AS preview
              FROM notes`
      },
      {
        key: 'event',
        sql: `SELECT id, username, title, updatedAt, createdAt,
              CASE
                WHEN recurrence IS NOT NULL AND trim(recurrence) != '' THEN '重复事件'
                WHEN allDay = 1 THEN '全天事件'
                ELSE '日程事件'
              END AS status,
              substr(COALESCE(description, ''), 1, 140) AS preview
              FROM events`
      },
      {
        key: 'todo',
        sql: `SELECT id, username, title, updatedAt, createdAt,
              CASE WHEN completed = 1 THEN '已完成' ELSE '待处理' END AS status,
              substr(COALESCE(description, ''), 1, 140) AS preview
              FROM todos`
      },
      {
        key: 'contact',
        sql: `SELECT id, username, fn AS title, updatedAt, createdAt,
              CASE
                WHEN org IS NOT NULL AND trim(org) != '' THEN '联系人 / ' || org
                ELSE '联系人'
              END AS status,
              substr(trim(
                COALESCE(title, '') ||
                CASE
                  WHEN title IS NOT NULL AND trim(title) != '' AND note IS NOT NULL AND trim(note) != '' THEN ' · '
                  ELSE ''
                END ||
                COALESCE(note, '')
              ), 1, 140) AS preview
              FROM contacts`
      }
    ];

    const activeSources = type === 'all' ? sources : sources.filter(source => source.key === type);
    const searchClause = search ? ' WHERE username LIKE ? OR title LIKE ? OR preview LIKE ?' : '';
    const unionParams = search
      ? activeSources.flatMap(() => [`%${search}%`, `%${search}%`, `%${search}%`])
      : [];

    const unionSql = activeSources
      .map(source => `SELECT '${source.key}' AS type, id, username, title, updatedAt, createdAt, status, preview FROM (${source.sql})${searchClause}`)
      .join(' UNION ALL ');

    const countRow = await db.queryOne(`SELECT COUNT(*) AS total FROM (${unionSql}) AS workspace_items`, unionParams);
    const counts = await db.queryAll(
      `SELECT type, COUNT(*) AS count FROM (${unionSql}) AS workspace_items GROUP BY type`,
      unionParams
    );
    const items = await db.queryAll(
      `SELECT * FROM (${unionSql}) AS workspace_items
       ORDER BY updatedAt DESC, createdAt DESC
       LIMIT ? OFFSET ?`,
      [...unionParams, limit, offset]
    );

    const countMap = { note: 0, event: 0, todo: 0, contact: 0 };
    for (const row of counts) {
      if (row?.type && Object.prototype.hasOwnProperty.call(countMap, row.type)) {
        countMap[row.type] = Number(row.count) || 0;
      }
    }

    const total = Number(countRow?.total) || 0;
    res.json({
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      counts: countMap,
      items
    });
  } catch (e) {
    log('ERROR', '获取统一工作区内容失败', {
      requestedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: '获取工作区内容失败' });
  }
});

router.get('/api/admin/workspace/overview', async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 30);
    const overviewQuery = buildWorkspaceOverviewQuery();
    const params = [];
    let wrappedQuery = `SELECT username,
      SUM(itemCount) AS totalCount,
      SUM(CASE WHEN type = 'note' THEN itemCount ELSE 0 END) AS noteCount,
      SUM(CASE WHEN type = 'event' THEN itemCount ELSE 0 END) AS eventCount,
      SUM(CASE WHEN type = 'todo' THEN itemCount ELSE 0 END) AS todoCount,
      SUM(CASE WHEN type = 'contact' THEN itemCount ELSE 0 END) AS contactCount,
      MAX(lastUpdatedAt) AS lastUpdatedAt
      FROM (${overviewQuery}) AS source`;
    if (search) {
      wrappedQuery += ' WHERE username LIKE ?';
      params.push(`%${search}%`);
    }
    wrappedQuery += ' GROUP BY username ORDER BY lastUpdatedAt DESC, totalCount DESC LIMIT ?';
    params.push(limit);

    const users = await db.queryAll(wrappedQuery, params);
    res.json({ users });
  } catch (e) {
    log('ERROR', '获取工作区用户概览失败', {
      requestedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: '获取工作区概览失败' });
  }
});

router.get('/api/admin/workspace/:type/:id/detail', async (req, res) => {
  const type = normalizeWorkspaceType(req.params.type);
  const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';

  if (type === 'all' || !id || !username) {
    return res.status(400).json({ error: '参数不完整' });
  }

  try {
    const item = await getWorkspaceItemDetail(type, id, username);
    res.json(item);
  } catch (e) {
    if (e.message === 'WORKSPACE_ITEM_NOT_FOUND' || e.message === 'CONTACT_NOT_FOUND') {
      return res.status(404).json({ error: '内容不存在' });
    }
    if (e.message === 'INVALID_WORKSPACE_TYPE') {
      return res.status(400).json({ error: '内容类型无效' });
    }
    res.status(500).json({ error: '获取详情失败' });
  }
});

router.delete('/api/admin/workspace/:type/:id', async (req, res) => {
  const type = normalizeWorkspaceType(req.params.type);
  const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';

  if (type === 'all' || !id || !username) {
    return res.status(400).json({ error: '参数不完整' });
  }

  try {
    await deleteWorkspaceItem(type, id, username, req.user);
    res.json({ status: 'ok' });
  } catch (e) {
    if (e.message === 'WORKSPACE_ITEM_NOT_FOUND') {
      return res.status(404).json({ error: '内容不存在' });
    }
    if (e.message === 'INVALID_WORKSPACE_TYPE') {
      return res.status(400).json({ error: '内容类型无效' });
    }
    res.status(500).json({ error: '删除失败' });
  }
});

router.post('/api/admin/workspace/batch-delete', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ error: '未提供待删除内容' });
  }

  try {
    for (const item of items) {
      const type = normalizeWorkspaceType(item?.type);
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      const username = typeof item?.username === 'string' ? item.username.trim() : '';
      if (type === 'all' || !id || !username) {
        return res.status(400).json({ error: '批量删除参数无效' });
      }
      await deleteWorkspaceItem(type, id, username, req.user);
    }

    res.json({ status: 'ok', count: items.length });
  } catch (e) {
    if (e.message === 'WORKSPACE_ITEM_NOT_FOUND') {
      return res.status(404).json({ error: '部分内容不存在，批量删除已中止' });
    }
    if (e.message === 'INVALID_WORKSPACE_TYPE') {
      return res.status(400).json({ error: '存在无效的内容类型' });
    }
    res.status(500).json({ error: '批量删除失败' });
  }
});

// 删除笔记
router.delete('/api/admin/notes/:id', async (req, res) => {
  await db.execute('DELETE FROM notes WHERE id = ?', [req.params.id]);
  log('INFO', '管理员删除笔记', { noteId: req.params.id, deletedBy: req.user });
  res.json({ status: "ok" });
});

// 更新 CDN 缓存
router.post('/api/admin/cdn/update', async (req, res) => {
  try {
    const result = await updateAllResources();
    log('INFO', '管理员更新 CDN 缓存', {
      event: ADMIN_EVENTS.CDN_UPDATE_SUCCESS,
      updatedBy: req.user,
      result
    });
    res.json({ status: "ok", ...result });
  } catch (e) {
    log('ERROR', '管理员更新 CDN 缓存失败', {
      event: ADMIN_EVENTS.CDN_UPDATE_FAILED,
      updatedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: e.message });
  }
});

// 获取 CDN 配置
router.get('/api/admin/cdn/config', async (req, res) => {
  try {
    const { baseUrl } = getCdnConfig();
    res.json({ status: "ok", baseUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新 CDN 配置
router.post('/api/admin/cdn/config', async (req, res) => {
  try {
    const { baseUrl } = req.body;
    if (!baseUrl) {
      return res.status(400).json({ error: "baseUrl 不能为空" });
    }
    updateCdnConfig(baseUrl);
    log('INFO', '管理员修改 CDN 配置', {
      event: ADMIN_EVENTS.CDN_CONFIG_UPDATE_SUCCESS,
      updatedBy: req.user,
      baseUrl
    });
    res.json({ status: "ok", baseUrl });
  } catch (e) {
    log('ERROR', '管理员修改 CDN 配置失败', {
      event: ADMIN_EVENTS.CDN_CONFIG_UPDATE_FAILED,
      updatedBy: req.user,
      error: e.message
    });
    res.status(400).json({ error: e.message });
  }
});

// 获取 CDN 状态
router.get('/api/admin/cdn/status', async (req, res) => {
  try {
    const status = await getCDNStatus();
    res.json({ status: "ok", resources: status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 清理 CDN 缓存
router.post('/api/admin/cdn/clear', async (req, res) => {
  try {
    const result = await clearCache();
    log('INFO', '管理员清理 CDN 缓存', {
      event: ADMIN_EVENTS.CDN_CLEAR_SUCCESS,
      updatedBy: req.user,
      result
    });
    res.json({ status: "ok", ...result });
  } catch (e) {
    log('ERROR', '管理员清理 CDN 缓存失败', {
      event: ADMIN_EVENTS.CDN_CLEAR_FAILED,
      updatedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: e.message });
  }
});

// 获取 SMTP 配置
router.get('/api/admin/smtp/config', async (req, res) => {
  try {
    const smtpConfig = await getSmtpConfigSnapshot();
    res.json({ status: "ok", config: smtpConfig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新 SMTP 配置
router.post('/api/admin/smtp/config', async (req, res) => {
  try {
    const { host, port, secure, user, pass } = req.body;
    
    await updateSmtpSettings({ host, port, secure, user, pass });
    log('INFO', '管理员修改 SMTP 配置', {
      event: ADMIN_EVENTS.SMTP_CONFIG_UPDATE_SUCCESS,
      updatedBy: req.user,
      host,
      port,
      user
    });
    res.json({ status: "ok", message: 'SMTP 配置已更新' });
  } catch (e) {
    log('ERROR', '管理员修改 SMTP 配置失败', {
      event: ADMIN_EVENTS.SMTP_CONFIG_UPDATE_FAILED,
      updatedBy: req.user,
      error: e.message,
      stack: e.stack
    });
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

// 测试 SMTP 配置
router.post('/api/admin/smtp/test', async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) {
      return res.status(400).json({ error: '请提供测试邮箱地址' });
    }

    const { sendMail } = require('../services/mailer');
    await sendMail({
      to,
      subject: 'z7Note SMTP 配置测试',
      text: '这是一封测试邮件，如果您收到此邮件，说明 SMTP 配置正确。',
      html: '<p>这是一封测试邮件，如果您收到此邮件，说明 SMTP 配置正确。</p>'
    });

    log('INFO', '管理员测试 SMTP 配置', {
      event: ADMIN_EVENTS.SMTP_TEST_SUCCESS,
      updatedBy: req.user,
      to
    });
    res.json({ status: "ok", message: '测试邮件已发送' });
  } catch (e) {
    log('ERROR', '管理员测试 SMTP 配置失败', {
      event: ADMIN_EVENTS.SMTP_TEST_FAILED,
      updatedBy: req.user,
      error: e.message,
      stack: e.stack
    });
    res.status(500).json({ error: '测试失败: ' + e.message });
  }
});

// 获取系统配置
router.get('/api/admin/system/config', async (req, res) => {
  try {
    const systemConfig = await getSystemConfigSnapshot();
    res.json({ status: "ok", config: systemConfig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新系统配置
router.post('/api/admin/system/config', async (req, res) => {
  try {
    const { configs } = req.body;
    if (!configs || typeof configs !== 'object') {
      return res.status(400).json({ error: "无效的配置数据" });
    }

    await updateSystemConfigs(configs);
    log('INFO', '管理员修改系统配置', {
      event: ADMIN_EVENTS.SYSTEM_CONFIG_UPDATE_SUCCESS,
      updatedBy: req.user,
      configs
    });
    res.json({ status: "ok" });
  } catch (e) {
    log('ERROR', '管理员修改系统配置失败', {
      event: ADMIN_EVENTS.SYSTEM_CONFIG_UPDATE_FAILED,
      updatedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: e.message });
  }
});

// 恢复默认配置
router.post('/api/admin/system/config/reset', async (req, res) => {
  try {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys)) {
      return res.status(400).json({ error: "无效的key数组" });
    }

    await resetSystemConfigs(keys);

    log('INFO', '管理员重置系统配置', {
      event: ADMIN_EVENTS.SYSTEM_CONFIG_RESET_SUCCESS,
      resetBy: req.user,
      keys
    });
    res.json({ status: "ok" });
  } catch (e) {
    log('ERROR', '管理员重置系统配置失败', {
      event: ADMIN_EVENTS.SYSTEM_CONFIG_RESET_FAILED,
      resetBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: e.message });
  }
});

// 清理过期的上传会话
router.post('/api/admin/system/cleanup-uploads', async (req, res) => {
  try {
    const count = await cleanupUploadSessions();
    log('INFO', '管理员清理过期上传会话', {
      event: ADMIN_EVENTS.CLEANUP_UPLOADS_SUCCESS,
      cleanedBy: req.user,
      count
    });
    res.json({ status: "ok", count });
  } catch (e) {
    log('ERROR', '管理员清理过期上传会话失败', {
      event: ADMIN_EVENTS.CLEANUP_UPLOADS_FAILED,
      cleanedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: e.message });
  }
});

// 初始化默认配置
router.post('/api/admin/system/init-defaults', async (req, res) => {
  try {
    await initializeDefaultSystemConfig();
    log('INFO', '初始化默认系统配置', {
      event: ADMIN_EVENTS.INIT_DEFAULTS_SUCCESS,
      initializedBy: req.user
    });
    res.json({ status: "ok", message: "默认配置已初始化" });
  } catch (e) {
    log('ERROR', '初始化默认系统配置失败', {
      event: ADMIN_EVENTS.INIT_DEFAULTS_FAILED,
      initializedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: e.message });
  }
});

// 清空所有用户的回收站
router.delete('/api/admin/trash/empty-all', async (req, res) => {
  try {
    const result = await db.execute(
      'DELETE FROM notes WHERE deleted = 1'
    );
    log('INFO', '清空所有回收站', {
      event: ADMIN_EVENTS.TRASH_EMPTY_ALL_SUCCESS,
      count: result.changes,
      clearedBy: req.user
    });
    res.json({ status: 'ok', count: result.changes });
  } catch (e) {
    log('ERROR', '清空所有回收站失败', {
      event: ADMIN_EVENTS.TRASH_EMPTY_ALL_FAILED,
      clearedBy: req.user,
      error: e.message
    });
    res.status(500).json({ error: '清空失败' });
  }
});

  // 获取数据库空间信息
  router.get('/api/admin/database/info', async (req, res) => {
    try {
      const dbPath = config.paths.database;
      const dbStats = await fs.stat(dbPath);
      const dbSizeBytes = dbStats.size;
      const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);

      const storageStats = await db.maintenance.getStorageStats();
      const totalPages = storageStats.pageCount || 0;
      const pageSize = storageStats.pageSize || 4096;
      const freePages = storageStats.freelistCount || 0;
      const freeBytes = freePages * pageSize;
      const freeMB = (freeBytes / (1024 * 1024)).toFixed(2);
      const usedMB = (dbSizeMB - freeMB).toFixed(2);

      res.json({
        totalSizeMB: dbSizeMB,
        usedSizeMB: usedMB,
        freeSpaceMB: freeMB,
        totalPages,
        freePages,
        pageSize
      });
    } catch (e) {
      log('ERROR', '获取数据库信息失败', {
        event: ADMIN_EVENTS.DATABASE_INFO_FAILED,
        requestedBy: req.user,
        error: e.message
      });
      res.status(500).json({ error: '获取数据库信息失败' });
    }
  });

  // 执行数据库VACUUM清理
  router.post('/api/admin/database/vacuum', async (req, res) => {
    try {
      log('INFO', '开始执行数据库VACUUM', {
        event: ADMIN_EVENTS.DATABASE_VACUUM_STARTED,
        startedBy: req.user
      });

      // 执行VACUUM操作
      await db.maintenance.compact();

      log('INFO', '数据库VACUUM完成', {
        event: ADMIN_EVENTS.DATABASE_VACUUM_SUCCESS,
        completedBy: req.user
      });
      res.json({ status: 'ok', message: '数据库清理完成' });
    } catch (e) {
      log('ERROR', '数据库VACUUM失败', {
        event: ADMIN_EVENTS.DATABASE_VACUUM_FAILED,
        failedBy: req.user,
        error: e.message
      });
      res.status(500).json({ error: '数据库清理失败: ' + e.message });
    }
  });

  module.exports = router;
