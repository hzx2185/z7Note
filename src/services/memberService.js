const crypto = require('crypto');
const db = require('../db/client');
const config = require('../config');

const DEFAULT_PLAN_CONFIGS = {
  free: {
    planKey: 'free',
    planName: 'Free',
    planBadge: '个人试用',
    planSummary: '可使用笔记、日历、通讯录全部基础功能。',
    noteLimit: config.defaultNoteLimit,
    fileLimit: config.defaultFileLimit,
    eventLimit: 200,
    todoLimit: 300,
    contactLimit: 200,
    features: [
      '基础笔记、日历、通讯录能力',
      '基础提醒与数据管理',
      '适合轻量个人记录'
    ],
    capabilities: {
      notesEnabled: true,
      calendarEnabled: true,
      todosEnabled: true,
      contactsEnabled: true,
      attachmentsEnabled: true,
      noteSharingEnabled: false,
      fileSharingEnabled: false,
      importExport: false,
      remindersEnabled: true,
      emailRemindersEnabled: false,
      browserRemindersEnabled: true,
      caldavRemindersEnabled: false,
      calendarSubscriptionsEnabled: false,
      webdavEnabled: false,
      caldavEnabled: false,
      carddavEnabled: false,
      attachmentPreviewEnabled: true,
      attachmentManageEnabled: true,
      searchEnabled: true,
      advancedSharing: false,
      backupExportEnabled: false,
      teamWorkspace: false,
      adminWorkbench: false
    }
  },
  pro: {
    planKey: 'pro',
    planName: 'Pro',
    planBadge: '个人会员',
    planSummary: '统一提升笔记、日历、通讯录的配额和高级功能。',
    noteLimit: 300,
    fileLimit: 1500,
    eventLimit: 2000,
    todoLimit: 3000,
    contactLimit: 2000,
    features: [
      '统一提升笔记与附件空间',
      '增强分享、导入导出与同步',
      '适合高频个人工作区'
    ],
    capabilities: {
      notesEnabled: true,
      calendarEnabled: true,
      todosEnabled: true,
      contactsEnabled: true,
      attachmentsEnabled: true,
      noteSharingEnabled: true,
      fileSharingEnabled: true,
      advancedSharing: true,
      importExport: true,
      remindersEnabled: true,
      emailRemindersEnabled: true,
      browserRemindersEnabled: true,
      caldavRemindersEnabled: true,
      calendarSubscriptionsEnabled: true,
      webdavEnabled: true,
      caldavEnabled: true,
      carddavEnabled: true,
      attachmentPreviewEnabled: true,
      attachmentManageEnabled: true,
      searchEnabled: true,
      backupExportEnabled: true,
      teamWorkspace: false,
      adminWorkbench: false
    }
  },
  team: {
    planKey: 'team',
    planName: 'Team',
    planBadge: '团队版',
    planSummary: '统一覆盖笔记、日历、通讯录的团队协作与共享能力。',
    noteLimit: 1000,
    fileLimit: 5000,
    eventLimit: 10000,
    todoLimit: 12000,
    contactLimit: 10000,
    features: [
      '更高统一空间配额',
      '团队协作与共享策略',
      '适合小团队运营与管理'
    ],
    capabilities: {
      notesEnabled: true,
      calendarEnabled: true,
      todosEnabled: true,
      contactsEnabled: true,
      attachmentsEnabled: true,
      noteSharingEnabled: true,
      fileSharingEnabled: true,
      advancedSharing: true,
      importExport: true,
      remindersEnabled: true,
      emailRemindersEnabled: true,
      browserRemindersEnabled: true,
      caldavRemindersEnabled: true,
      calendarSubscriptionsEnabled: true,
      webdavEnabled: true,
      caldavEnabled: true,
      carddavEnabled: true,
      attachmentPreviewEnabled: true,
      attachmentManageEnabled: true,
      searchEnabled: true,
      backupExportEnabled: true,
      teamWorkspace: true,
      adminWorkbench: true
    }
  }
};

function normalizePlanKey(planKey) {
  const normalized = typeof planKey === 'string' ? planKey.trim().toLowerCase() : '';
  return ['free', 'pro', 'team'].includes(normalized) ? normalized : 'free';
}

function getDefaultPlanConfig(planKey) {
  const normalizedPlanKey = normalizePlanKey(planKey);
  const plan = DEFAULT_PLAN_CONFIGS[normalizedPlanKey] || DEFAULT_PLAN_CONFIGS.free;
  return {
    planKey: plan.planKey,
    planName: plan.planName,
    planBadge: plan.planBadge,
    planSummary: plan.planSummary,
    noteLimit: Number(plan.noteLimit || 0),
    fileLimit: Number(plan.fileLimit || 0),
    eventLimit: Number(plan.eventLimit || 0),
    todoLimit: Number(plan.todoLimit || 0),
    contactLimit: Number(plan.contactLimit || 0),
    features: Array.isArray(plan.features) ? [...plan.features] : [],
    capabilities: { ...(plan.capabilities || {}) }
  };
}

function normalizePlanConfig(planKey, raw = {}) {
  const defaults = getDefaultPlanConfig(planKey);
  const features = Array.isArray(raw.features)
    ? raw.features.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20)
    : defaults.features;
  const capabilities = {
    ...defaults.capabilities,
    ...(raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : {})
  };

  return {
    planKey: defaults.planKey,
    planName: String(raw.planName || defaults.planName).trim() || defaults.planName,
    planBadge: String(raw.planBadge || defaults.planBadge).trim() || defaults.planBadge,
    planSummary: String(raw.planSummary || defaults.planSummary).trim() || defaults.planSummary,
    noteLimit: Number.isFinite(Number(raw.noteLimit)) && Number(raw.noteLimit) > 0
      ? Math.floor(Number(raw.noteLimit))
      : defaults.noteLimit,
    fileLimit: Number.isFinite(Number(raw.fileLimit)) && Number(raw.fileLimit) > 0
      ? Math.floor(Number(raw.fileLimit))
      : defaults.fileLimit,
    eventLimit: Number.isFinite(Number(raw.eventLimit)) && Number(raw.eventLimit) > 0
      ? Math.floor(Number(raw.eventLimit))
      : defaults.eventLimit,
    todoLimit: Number.isFinite(Number(raw.todoLimit)) && Number(raw.todoLimit) > 0
      ? Math.floor(Number(raw.todoLimit))
      : defaults.todoLimit,
    contactLimit: Number.isFinite(Number(raw.contactLimit)) && Number(raw.contactLimit) > 0
      ? Math.floor(Number(raw.contactLimit))
      : defaults.contactLimit,
    features,
    capabilities: {
      notesEnabled: capabilities.notesEnabled === true || capabilities.notesEnabled === 'true',
      calendarEnabled: capabilities.calendarEnabled === true || capabilities.calendarEnabled === 'true',
      todosEnabled: capabilities.todosEnabled === true || capabilities.todosEnabled === 'true',
      contactsEnabled: capabilities.contactsEnabled === true || capabilities.contactsEnabled === 'true',
      attachmentsEnabled: capabilities.attachmentsEnabled === true || capabilities.attachmentsEnabled === 'true',
      noteSharingEnabled: capabilities.noteSharingEnabled === true || capabilities.noteSharingEnabled === 'true',
      fileSharingEnabled: capabilities.fileSharingEnabled === true || capabilities.fileSharingEnabled === 'true',
      advancedSharing: capabilities.advancedSharing === true || capabilities.advancedSharing === 'true',
      importExport: capabilities.importExport === true || capabilities.importExport === 'true',
      remindersEnabled: capabilities.remindersEnabled === true || capabilities.remindersEnabled === 'true',
      emailRemindersEnabled: capabilities.emailRemindersEnabled === true || capabilities.emailRemindersEnabled === 'true',
      browserRemindersEnabled: capabilities.browserRemindersEnabled === true || capabilities.browserRemindersEnabled === 'true',
      caldavRemindersEnabled: capabilities.caldavRemindersEnabled === true || capabilities.caldavRemindersEnabled === 'true',
      calendarSubscriptionsEnabled: capabilities.calendarSubscriptionsEnabled === true || capabilities.calendarSubscriptionsEnabled === 'true',
      webdavEnabled: capabilities.webdavEnabled === true || capabilities.webdavEnabled === 'true',
      caldavEnabled: capabilities.caldavEnabled === true || capabilities.caldavEnabled === 'true',
      carddavEnabled: capabilities.carddavEnabled === true || capabilities.carddavEnabled === 'true',
      attachmentPreviewEnabled: capabilities.attachmentPreviewEnabled === true || capabilities.attachmentPreviewEnabled === 'true',
      attachmentManageEnabled: capabilities.attachmentManageEnabled === true || capabilities.attachmentManageEnabled === 'true',
      searchEnabled: capabilities.searchEnabled === true || capabilities.searchEnabled === 'true',
      backupExportEnabled: capabilities.backupExportEnabled === true || capabilities.backupExportEnabled === 'true',
      teamWorkspace: capabilities.teamWorkspace === true || capabilities.teamWorkspace === 'true',
      adminWorkbench: capabilities.adminWorkbench === true || capabilities.adminWorkbench === 'true'
    }
  };
}

async function getPlanConfig(planKey, executor = db) {
  const normalizedPlanKey = normalizePlanKey(planKey);
  const row = await executor.queryOne(
    'SELECT value FROM system_config WHERE key = ?',
    [`memberPlan.${normalizedPlanKey}`]
  );

  if (!row?.value) {
    return getDefaultPlanConfig(normalizedPlanKey);
  }

  try {
    return normalizePlanConfig(normalizedPlanKey, JSON.parse(row.value));
  } catch {
    return getDefaultPlanConfig(normalizedPlanKey);
  }
}

async function listPlanConfigs(executor = db) {
  return Promise.all(['free', 'pro', 'team'].map((planKey) => getPlanConfig(planKey, executor)));
}

async function updatePlanConfigs(configs = {}, executor = db) {
  const planKeys = ['free', 'pro', 'team'];
  const updatedAt = Math.floor(Date.now() / 1000);

  for (const planKey of planKeys) {
    if (!configs[planKey]) continue;
    const nextConfig = normalizePlanConfig(planKey, configs[planKey]);
    await executor.upsert(
      'system_config',
      {
        key: `memberPlan.${planKey}`,
        value: JSON.stringify(nextConfig),
        description: `${nextConfig.planName} 套餐配置`,
        updatedAt
      },
      ['value', 'description', 'updatedAt'],
      ['key']
    );
  }
}

async function getPlanQuotaPresetAsync(planKey, executor = db) {
  const plan = await getPlanConfig(planKey, executor);
  return { noteLimit: plan.noteLimit, fileLimit: plan.fileLimit };
}

async function getPlanSummaryAsync(planKey, executor = db) {
  const plan = await getPlanConfig(planKey, executor);
  return {
    planKey: plan.planKey,
    planName: plan.planName,
    planBadge: plan.planBadge,
    planSummary: plan.planSummary,
    eventLimit: plan.eventLimit,
    todoLimit: plan.todoLimit,
    contactLimit: plan.contactLimit,
    planFeatures: plan.features,
    planCapabilities: plan.capabilities
  };
}

function calculatePlanExpiry(currentExpiresAt, durationDays) {
  const resolvedDurationDays = Number.isFinite(Number(durationDays)) && Number(durationDays) > 0
    ? Math.floor(Number(durationDays))
    : 0;
  if (!resolvedDurationDays) return 0;

  const now = Math.floor(Date.now() / 1000);
  const current = Number.isFinite(Number(currentExpiresAt)) ? Number(currentExpiresAt) : 0;
  const startAt = current > now ? current : now;
  return startAt + (resolvedDurationDays * 24 * 60 * 60);
}

function getRemainingPlanDays(planExpiresAt) {
  const expiresAt = Number.isFinite(Number(planExpiresAt)) ? Number(planExpiresAt) : 0;
  if (!expiresAt) return 0;
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now) return 0;
  return Math.ceil((expiresAt - now) / (24 * 60 * 60));
}

function normalizeCode(rawCode = '') {
  return String(rawCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeMembershipOperator(operator) {
  return String(operator || '').trim() || 'system';
}

function normalizeMembershipSource(source) {
  return String(source || '').trim() || 'system';
}

function normalizeMembershipDetails(details) {
  if (!details || typeof details !== 'object') {
    return '';
  }
  try {
    return JSON.stringify(details);
  } catch {
    return '';
  }
}

function generateRedeemCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const chars = [];

  for (let i = 0; i < 12; i += 1) {
    chars.push(alphabet[bytes[i] % alphabet.length]);
  }

  return chars.join('');
}

async function createRedeemCode({
  code,
  planKey,
  noteLimit,
  fileLimit,
  durationDays = 0,
  maxRedemptions = 1,
  expiresAt = 0,
  createdBy = ''
}) {
  const normalizedPlanKey = normalizePlanKey(planKey);
  const preset = await getPlanQuotaPresetAsync(normalizedPlanKey);
  const resolvedNoteLimit = Number.isFinite(Number(noteLimit)) && Number(noteLimit) > 0 ? Number(noteLimit) : preset.noteLimit;
  const resolvedFileLimit = Number.isFinite(Number(fileLimit)) && Number(fileLimit) > 0 ? Number(fileLimit) : preset.fileLimit;
  const resolvedDurationDays = Number.isFinite(Number(durationDays)) && Number(durationDays) > 0 ? Math.floor(Number(durationDays)) : 0;
  const resolvedMaxRedemptions = Number.isFinite(Number(maxRedemptions)) && Number(maxRedemptions) > 0 ? Math.floor(Number(maxRedemptions)) : 1;
  const resolvedExpiresAt = Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0 ? Math.floor(Number(expiresAt)) : 0;
  const now = Math.floor(Date.now() / 1000);

  let nextCode = normalizeCode(code);
  if (!nextCode) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateRedeemCode();
      const normalizedCandidate = normalizeCode(candidate);
      const existing = await db.queryOne('SELECT code FROM redeem_codes WHERE code = ?', [normalizedCandidate]);
      if (!existing) {
        nextCode = normalizedCandidate;
        break;
      }
    }
  }

  if (!nextCode) {
    throw new Error('REDEEM_CODE_GENERATION_FAILED');
  }

  const existing = await db.queryOne('SELECT code FROM redeem_codes WHERE code = ?', [nextCode]);
  if (existing) {
    throw new Error('REDEEM_CODE_EXISTS');
  }

  await db.execute(
    `INSERT INTO redeem_codes (
      code, planKey, noteLimit, fileLimit, durationDays, maxRedemptions, redeemedCount, enabled, expiresAt, createdBy, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)`,
    [nextCode, normalizedPlanKey, resolvedNoteLimit, resolvedFileLimit, resolvedDurationDays, resolvedMaxRedemptions, resolvedExpiresAt, createdBy, now, now]
  );

  return {
    code: nextCode,
    planKey: normalizedPlanKey,
    noteLimit: resolvedNoteLimit,
    fileLimit: resolvedFileLimit,
    durationDays: resolvedDurationDays,
    maxRedemptions: resolvedMaxRedemptions,
    expiresAt: resolvedExpiresAt,
    enabled: 1,
    createdBy,
    createdAt: now
  };
}

async function createRedeemCodesBatch({
  count,
  planKey,
  noteLimit,
  fileLimit,
  durationDays = 0,
  maxRedemptions = 1,
  expiresAt = 0,
  createdBy = ''
}) {
  const resolvedCount = Number.isFinite(Number(count)) && Number(count) > 0 ? Math.min(Math.floor(Number(count)), 100) : 1;
  const created = [];

  for (let index = 0; index < resolvedCount; index += 1) {
    created.push(await createRedeemCode({
      planKey,
      noteLimit,
      fileLimit,
      durationDays,
      maxRedemptions,
      expiresAt,
      createdBy
    }));
  }

  return created;
}

async function listRedeemCodes() {
  return db.queryAll(
    `SELECT code, planKey, noteLimit, fileLimit, durationDays, maxRedemptions, redeemedCount, enabled, expiresAt, createdBy, createdAt, updatedAt
     FROM redeem_codes
     ORDER BY createdAt DESC, code DESC`
  );
}

async function listRedeemCodeRedemptions({ search = '', limit = 100 } = {}) {
  const resolvedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Math.floor(Number(limit)), 500) : 100;
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const params = [];
  let whereClause = '';

  if (normalizedSearch) {
    whereClause = `
      WHERE LOWER(username) LIKE ?
         OR LOWER(code) LIKE ?
         OR LOWER(planKey) LIKE ?
    `;
    const pattern = `%${normalizedSearch}%`;
    params.push(pattern, pattern, pattern);
  }

  return db.queryAll(
    `SELECT id, code, username, planKey, noteLimit, fileLimit, durationDays, planExpiresAt, redeemedAt
     FROM redeem_code_redemptions
     ${whereClause}
     ORDER BY redeemedAt DESC, id DESC
     LIMIT ?`,
    [...params, resolvedLimit]
  );
}

async function recordMembershipOperation({
  username,
  action,
  operator = 'system',
  source = 'system',
  planKey = 'free',
  noteLimit = 0,
  fileLimit = 0,
  durationDays = 0,
  planExpiresAt = 0,
  redeemCode = '',
  details = null,
  createdAt = Math.floor(Date.now() / 1000)
} = {}, executor = db) {
  const resolvedUsername = String(username || '').trim();
  const resolvedAction = String(action || '').trim();

  if (!resolvedUsername || !resolvedAction) {
    throw new Error('INVALID_MEMBERSHIP_OPERATION');
  }

  await executor.execute(
    `INSERT INTO membership_operations (
      username, action, operator, source, planKey, noteLimit, fileLimit,
      durationDays, planExpiresAt, redeemCode, details, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      resolvedUsername,
      resolvedAction,
      normalizeMembershipOperator(operator),
      normalizeMembershipSource(source),
      normalizePlanKey(planKey),
      Number.isFinite(Number(noteLimit)) ? Number(noteLimit) : 0,
      Number.isFinite(Number(fileLimit)) ? Number(fileLimit) : 0,
      Number.isFinite(Number(durationDays)) ? Math.trunc(Number(durationDays)) : 0,
      Number.isFinite(Number(planExpiresAt)) ? Number(planExpiresAt) : 0,
      normalizeCode(redeemCode),
      normalizeMembershipDetails(details),
      Number.isFinite(Number(createdAt)) ? Math.floor(Number(createdAt)) : Math.floor(Date.now() / 1000)
    ]
  );
}

async function listMembershipOperations({ search = '', limit = 100 } = {}, executor = db) {
  const resolvedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Math.floor(Number(limit)), 500) : 100;
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const params = [];
  let whereClause = '';

  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`;
    whereClause = `
      WHERE LOWER(username) LIKE ?
         OR LOWER(action) LIKE ?
         OR LOWER(operator) LIKE ?
         OR LOWER(source) LIKE ?
         OR LOWER(planKey) LIKE ?
         OR LOWER(redeemCode) LIKE ?
         OR LOWER(details) LIKE ?
    `;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }

  return executor.queryAll(
    `SELECT id, username, action, operator, source, planKey, noteLimit, fileLimit,
            durationDays, planExpiresAt, redeemCode, details, createdAt
     FROM membership_operations
     ${whereClause}
     ORDER BY createdAt DESC, id DESC
     LIMIT ?`,
    [...params, resolvedLimit]
  );
}

async function setRedeemCodeEnabled(code, enabled) {
  const normalizedCode = normalizeCode(code);
  const now = Math.floor(Date.now() / 1000);
  const result = await db.execute(
    'UPDATE redeem_codes SET enabled = ?, updatedAt = ? WHERE code = ?',
    [enabled ? 1 : 0, now, normalizedCode]
  );
  if (!result.changes) {
    throw new Error('REDEEM_CODE_NOT_FOUND');
  }
}

async function syncUserMembershipState(username, executor = db) {
  const now = Math.floor(Date.now() / 1000);
  const user = await executor.queryOne(
    'SELECT username, planKey, noteLimit, fileLimit, planExpiresAt FROM users WHERE username = ?',
    [username]
  );

  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const expiresAt = Number(user.planExpiresAt || 0);
  const planKey = normalizePlanKey(user.planKey);

  if (planKey !== 'free' && expiresAt > 0 && expiresAt <= now) {
    const preset = await getPlanQuotaPresetAsync('free', executor);
    await executor.execute(
      `UPDATE users
       SET planKey = 'free', noteLimit = ?, fileLimit = ?, planExpiresAt = 0
       WHERE username = ?`,
      [preset.noteLimit, preset.fileLimit, username]
    );
    await recordMembershipOperation({
      username,
      action: 'expired_downgrade',
      operator: 'system',
      source: 'system_expiry',
      planKey: 'free',
      noteLimit: preset.noteLimit,
      fileLimit: preset.fileLimit,
      planExpiresAt: 0,
      details: {
        previousPlanKey: planKey,
        previousPlanExpiresAt: expiresAt
      },
      createdAt: now
    }, executor);
    return {
      ...user,
      planKey: 'free',
      noteLimit: preset.noteLimit,
      fileLimit: preset.fileLimit,
      planExpiresAt: 0
    };
  }

  return {
    ...user,
    planKey,
    planExpiresAt: expiresAt
  };
}

async function adjustUserMembershipDays(username, deltaDays, operator = 'system', executor = db) {
  const resolvedDeltaDays = Number.isFinite(Number(deltaDays)) ? Math.trunc(Number(deltaDays)) : 0;
  if (!resolvedDeltaDays) {
    throw new Error('INVALID_MEMBERSHIP_DELTA');
  }

  const user = await syncUserMembershipState(username, executor);
  if (user.planKey === 'free') {
    throw new Error('FREE_PLAN_CANNOT_ADJUST');
  }

  const now = Math.floor(Date.now() / 1000);
  const currentExpiresAt = Number(user.planExpiresAt || 0);

  if (currentExpiresAt <= 0 && resolvedDeltaDays < 0) {
    throw new Error('PERMANENT_PLAN_CANNOT_REDUCE');
  }

  let nextExpiresAt = 0;
  if (currentExpiresAt <= 0) {
    nextExpiresAt = now + (resolvedDeltaDays * 24 * 60 * 60);
  } else {
    nextExpiresAt = currentExpiresAt + (resolvedDeltaDays * 24 * 60 * 60);
  }

  if (nextExpiresAt <= now) {
    const preset = await getPlanQuotaPresetAsync('free', executor);
    await executor.execute(
      `UPDATE users
       SET planKey = 'free', noteLimit = ?, fileLimit = ?, planExpiresAt = 0
       WHERE username = ?`,
      [preset.noteLimit, preset.fileLimit, username]
    );
    await recordMembershipOperation({
      username,
      action: 'adjust_days',
      operator,
      source: 'admin_adjust',
      planKey: 'free',
      noteLimit: preset.noteLimit,
      fileLimit: preset.fileLimit,
      durationDays: resolvedDeltaDays,
      planExpiresAt: 0,
      details: {
        previousPlanKey: user.planKey,
        previousPlanExpiresAt: currentExpiresAt,
        result: 'downgraded_to_free'
      }
    }, executor);
    return {
      username,
      ...(await getPlanSummaryAsync('free', executor)),
      noteLimit: preset.noteLimit,
      fileLimit: preset.fileLimit,
      planExpiresAt: 0,
      changedDays: resolvedDeltaDays
    };
  }

  await executor.execute(
    'UPDATE users SET planExpiresAt = ? WHERE username = ?',
    [nextExpiresAt, username]
  );
  await recordMembershipOperation({
    username,
    action: 'adjust_days',
    operator,
    source: 'admin_adjust',
    planKey: user.planKey,
    noteLimit: user.noteLimit,
    fileLimit: user.fileLimit,
    durationDays: resolvedDeltaDays,
    planExpiresAt: nextExpiresAt,
    details: {
      previousPlanKey: user.planKey,
      previousPlanExpiresAt: currentExpiresAt
    }
  }, executor);

  return {
    username,
    ...(await getPlanSummaryAsync(user.planKey, executor)),
    noteLimit: user.noteLimit,
    fileLimit: user.fileLimit,
    planExpiresAt: nextExpiresAt,
    changedDays: resolvedDeltaDays
  };
}

async function redeemCodeForUser(code, username) {
  const normalizedCode = normalizeCode(code);
  const now = Math.floor(Date.now() / 1000);

  return db.withTransaction(async (tx) => {
    const currentUser = await syncUserMembershipState(username, tx);
    const redeemCode = await tx.queryOne(
      `SELECT code, planKey, noteLimit, fileLimit, durationDays, maxRedemptions, redeemedCount, enabled, expiresAt
       FROM redeem_codes WHERE code = ?`,
      [normalizedCode]
    );

    if (!redeemCode) {
      throw new Error('REDEEM_CODE_NOT_FOUND');
    }
    if (!redeemCode.enabled) {
      throw new Error('REDEEM_CODE_DISABLED');
    }
    if (redeemCode.expiresAt && redeemCode.expiresAt < now) {
      throw new Error('REDEEM_CODE_EXPIRED');
    }
    if (Number(redeemCode.redeemedCount || 0) >= Number(redeemCode.maxRedemptions || 0)) {
      throw new Error('REDEEM_CODE_DEPLETED');
    }

    const existingUsage = await tx.queryOne(
      'SELECT id FROM redeem_code_redemptions WHERE code = ? AND username = ?',
      [normalizedCode, username]
    );
    if (existingUsage) {
      throw new Error('REDEEM_CODE_ALREADY_USED');
    }

    const nextPlanExpiresAt = calculatePlanExpiry(currentUser.planExpiresAt, redeemCode.durationDays);

    await tx.execute(
      `UPDATE users
       SET planKey = ?, noteLimit = ?, fileLimit = ?, planExpiresAt = ?
       WHERE username = ?`,
      [redeemCode.planKey, redeemCode.noteLimit, redeemCode.fileLimit, nextPlanExpiresAt, username]
    );

    await tx.execute(
      `INSERT INTO redeem_code_redemptions (
        code, username, planKey, noteLimit, fileLimit, durationDays, planExpiresAt, redeemedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [normalizedCode, username, redeemCode.planKey, redeemCode.noteLimit, redeemCode.fileLimit, redeemCode.durationDays || 0, nextPlanExpiresAt, now]
    );

    await tx.execute(
      'UPDATE redeem_codes SET redeemedCount = redeemedCount + 1, updatedAt = ? WHERE code = ?',
      [now, normalizedCode]
    );

    await recordMembershipOperation({
      username,
      action: 'redeem',
      operator: username,
      source: 'redeem_code',
      planKey: redeemCode.planKey,
      noteLimit: redeemCode.noteLimit,
      fileLimit: redeemCode.fileLimit,
      durationDays: redeemCode.durationDays || 0,
      planExpiresAt: nextPlanExpiresAt,
      redeemCode: normalizedCode,
      details: {
        previousPlanKey: currentUser.planKey,
        previousPlanExpiresAt: currentUser.planExpiresAt || 0
      },
      createdAt: now
    }, tx);

    return {
      code: normalizedCode,
      ...(await getPlanSummaryAsync(redeemCode.planKey, tx)),
      noteLimit: redeemCode.noteLimit,
      fileLimit: redeemCode.fileLimit,
      durationDays: redeemCode.durationDays || 0,
      planExpiresAt: nextPlanExpiresAt,
      redeemedAt: now
    };
  });
}

module.exports = {
  normalizePlanKey,
  getPlanQuotaPresetAsync,
  getPlanSummaryAsync,
  getPlanConfig,
  listPlanConfigs,
  updatePlanConfigs,
  createRedeemCode,
  createRedeemCodesBatch,
  listRedeemCodes,
  listRedeemCodeRedemptions,
  listMembershipOperations,
  recordMembershipOperation,
  setRedeemCodeEnabled,
  syncUserMembershipState,
  adjustUserMembershipDays,
  getRemainingPlanDays,
  redeemCodeForUser
};
