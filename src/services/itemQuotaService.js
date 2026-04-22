const db = require('../db/client');
const { getPlanConfig } = require('./memberService');

const ITEM_QUOTA_CONFIG = {
  event: {
    table: 'events',
    field: 'eventLimit',
    label: '日历事件'
  },
  todo: {
    table: 'todos',
    field: 'todoLimit',
    label: '待办事项'
  },
  contact: {
    table: 'contacts',
    field: 'contactLimit',
    label: '联系人'
  }
};

function getQuotaMeta(type) {
  const meta = ITEM_QUOTA_CONFIG[type];
  if (!meta) {
    throw new Error('UNSUPPORTED_ITEM_QUOTA_TYPE');
  }
  return meta;
}

async function getUserPlanKey(username, executor = db) {
  const user = await executor.queryOne(
    'SELECT planKey FROM users WHERE username = ?',
    [username]
  );
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }
  return user.planKey;
}

async function getItemQuotaState(username, type, executor = db) {
  const meta = getQuotaMeta(type);
  const planKey = await getUserPlanKey(username, executor);
  const plan = await getPlanConfig(planKey, executor);
  const countRow = await executor.queryOne(
    `SELECT COUNT(*) AS total FROM ${meta.table} WHERE username = ?`,
    [username]
  );

  return {
    type,
    label: meta.label,
    planKey,
    limit: Number(plan[meta.field] || 0),
    current: Number(countRow?.total || 0)
  };
}

async function ensureItemQuotaAvailable(username, type, incomingCount = 1, executor = db) {
  const nextCount = Number.isFinite(Number(incomingCount)) ? Math.max(Math.floor(Number(incomingCount)), 0) : 0;
  if (nextCount <= 0) {
    return getItemQuotaState(username, type, executor);
  }

  const state = await getItemQuotaState(username, type, executor);
  if (state.limit > 0 && state.current + nextCount > state.limit) {
    const error = new Error('ITEM_QUOTA_EXCEEDED');
    error.type = state.type;
    error.label = state.label;
    error.limit = state.limit;
    error.current = state.current;
    error.incomingCount = nextCount;
    throw error;
  }

  return state;
}

module.exports = {
  getItemQuotaState,
  ensureItemQuotaAvailable
};
