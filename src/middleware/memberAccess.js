const db = require('../db/client');
const { syncUserMembershipState, getPlanConfig } = require('../services/memberService');

function respondCapabilityDenied(req, res, status, message) {
  if (
    req.xhr ||
    req.path.startsWith('/api/') ||
    req.headers.accept?.includes('application/json')
  ) {
    return res.status(status).json({ error: message });
  }
  return res.status(status).send(message);
}

async function loadUserPlanCapabilities(username) {
  await syncUserMembershipState(username);
  const user = await db.queryOne(
    'SELECT planKey FROM users WHERE username = ?',
    [username]
  );
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }
  const plan = await getPlanConfig(user.planKey);
  return {
    user,
    plan,
    capabilities: plan.capabilities || {}
  };
}

function requirePlanCapability(capabilityKey, options = {}) {
  const message = options.message || '当前套餐未启用此功能';

  return async (req, res, next) => {
    try {
      const username = req.user;
      if (!username) {
        return next();
      }

      const { capabilities } = await loadUserPlanCapabilities(username);
      if (capabilities[capabilityKey]) {
        return next();
      }

      return respondCapabilityDenied(req, res, 403, message);
    } catch (error) {
      if (error.message === 'USER_NOT_FOUND') {
        return respondCapabilityDenied(req, res, 404, '用户不存在');
      }
      return respondCapabilityDenied(req, res, 500, '套餐权限校验失败');
    }
  };
}

module.exports = {
  loadUserPlanCapabilities,
  requirePlanCapability
};
