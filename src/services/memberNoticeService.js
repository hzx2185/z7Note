const db = require('../db/client');
const log = require('../utils/logger');
const { sendMail } = require('./mailer');
const { getPlanSummaryAsync, getRemainingPlanDays, syncUserMembershipState } = require('./memberService');

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const ONE_DAY = 24 * 60 * 60;

async function sendMembershipExpiryNotices() {
  const now = Math.floor(Date.now() / 1000);
  const users = await db.queryAll(
    `SELECT username, email, planKey, planExpiresAt, membershipNoticeSentAt, membershipExpiredNoticeSentAt
     FROM users
     WHERE planKey != 'free' AND planExpiresAt > 0`
  );

  let expiringCount = 0;
  let expiredCount = 0;

  for (const user of users) {
    let currentUser = user;
    try {
      currentUser = await syncUserMembershipState(user.username);
    } catch (error) {
      log('ERROR', '同步会员到期提醒用户状态失败', { username: user.username, error: error.message, stack: error.stack });
      continue;
    }

    if (currentUser.planKey === 'free') {
      const lastExpiredNotice = Number(user.membershipExpiredNoticeSentAt || 0);
      if (user.email && (!lastExpiredNotice || now - lastExpiredNotice >= ONE_DAY)) {
        try {
          await sendMail({
            to: user.email,
            subject: '[z7Note] 会员已到期',
            text: `你的会员已到期，账号已回落到 Free 套餐。你仍可继续使用基础功能，若需恢复 Pro / Team 能力，可重新兑换会员。`
          });
          await db.execute(
            'UPDATE users SET membershipExpiredNoticeSentAt = ? WHERE username = ?',
            [now, user.username]
          );
          expiredCount += 1;
        } catch (error) {
          log('ERROR', '发送会员到期提醒失败', { username: user.username, error: error.message, stack: error.stack });
        }
      }
      continue;
    }

    if (!user.email) {
      continue;
    }

    const remainingDays = getRemainingPlanDays(currentUser.planExpiresAt);
    const lastNotice = Number(user.membershipNoticeSentAt || 0);
    const shouldNotifyExpiring = remainingDays > 0 && remainingDays <= 7 && (!lastNotice || now - lastNotice >= ONE_DAY);

    if (!shouldNotifyExpiring) {
      continue;
    }

    const plan = await getPlanSummaryAsync(currentUser.planKey);
    try {
      await sendMail({
        to: user.email,
        subject: `[z7Note] ${plan.planName} 套餐即将到期`,
        text: `你的 ${plan.planName} 套餐将在 ${remainingDays} 天后到期。\n\n到期时间：${new Date(currentUser.planExpiresAt * 1000).toLocaleString('zh-CN')}\n\n如需继续使用当前配额与高级功能，请及时续费或兑换新的会员码。`
      });
      await db.execute(
        'UPDATE users SET membershipNoticeSentAt = ? WHERE username = ?',
        [now, user.username]
      );
      expiringCount += 1;
    } catch (error) {
      log('ERROR', '发送会员即将到期提醒失败', { username: user.username, error: error.message, stack: error.stack });
    }
  }

  return { expiringCount, expiredCount };
}

module.exports = {
  sendMembershipExpiryNotices
};
