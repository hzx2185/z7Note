export const MEMBER_TIERS = [
  {
    key: 'free',
    name: 'Free',
    badge: '个人试用',
    price: '¥0',
    period: '/ 月',
    featured: false,
    features: [
      '包含笔记、日历、通讯录全部基础功能',
      '基础配额覆盖笔记、附件、日程与联系人管理',
      '适合个人体验、轻量记录与日常整理'
    ],
    quota: '1 人 / 轻量配额 / 基础提醒',
    target: '适合个人试用与轻量日常记录',
    ctaLabel: '立即体验',
    ctaHref: '/app',
    ctaVariant: 'secondary'
  },
  {
    key: 'pro',
    name: 'Pro',
    badge: '个人会员',
    price: '¥19',
    period: '/ 月',
    featured: true,
    features: [
      '笔记、日历、通讯录统一提升配额与使用强度',
      '高级分享、导入导出、提醒与同步增强',
      '适合把个人知识、日程和联系人长期集中管理'
    ],
    quota: '1 人 / 高配额 / 增强同步与分享',
    target: '适合长期个人工作区与高频使用',
    ctaLabel: '查看会员中心',
    ctaHref: '/member',
    ctaVariant: 'primary'
  },
  {
    key: 'team',
    name: 'Team',
    badge: '小团队',
    price: '¥79',
    period: '/ 月',
    featured: false,
    features: [
      '多成员统一使用笔记、日历、通讯录完整能力',
      '统一配额、成员管理、共享策略与管理工作台',
      '适合内部知识库、排期协同和客户联系人管理'
    ],
    quota: '多成员 / 统一组织配额 / 协作策略',
    target: '适合小团队、项目组和组织协同',
    ctaLabel: '打开管理工作台',
    ctaHref: '/admin',
    ctaVariant: 'secondary'
  }
];

let memberTierCache = [...MEMBER_TIERS];
let memberTierLoadPromise = null;

function formatQuotaLine(plan) {
  return [
    `${Number(plan.noteLimit || 0).toLocaleString('zh-CN')}MB 笔记`,
    `${Number(plan.fileLimit || 0).toLocaleString('zh-CN')}MB 附件`,
    `${Number(plan.eventLimit || 0).toLocaleString('zh-CN')} 事件`,
    `${Number(plan.contactLimit || 0).toLocaleString('zh-CN')} 联系人`
  ].join(' / ');
}

function mapPlanToTier(plan = {}, fallback = {}) {
  const planKey = String(plan.planKey || fallback.key || fallback.name || 'free').toLowerCase();
  return {
    key: planKey,
    name: plan.planName || fallback.name || 'Free',
    badge: plan.planBadge || fallback.badge || '',
    price: fallback.price || '¥0',
    period: fallback.period || '/ 月',
    featured: Boolean(fallback.featured),
    features: Array.isArray(plan.features) && plan.features.length ? plan.features : (fallback.features || []),
    quota: formatQuotaLine(plan),
    target: plan.planSummary || fallback.target || '统一覆盖工作区能力',
    ctaLabel: fallback.ctaLabel || '查看详情',
    ctaHref: fallback.ctaHref || '/pricing',
    ctaVariant: fallback.ctaVariant || 'secondary',
    summary: plan.planSummary || fallback.target || '统一覆盖工作区能力'
  };
}

export function getMemberTiersSync() {
  return memberTierCache;
}

export async function loadMemberTiers(forceRefresh = false) {
  if (!forceRefresh && memberTierLoadPromise) {
    return memberTierLoadPromise;
  }

  memberTierLoadPromise = (async () => {
    try {
      const response = await fetch('/api/public/member-plans', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load public member plans');
      }

      const plans = await response.json();
      const fallbackByKey = new Map(MEMBER_TIERS.map((tier) => [String(tier.key || tier.name).toLowerCase(), tier]));
      memberTierCache = plans.map((plan) => {
        const key = String(plan.planKey || '').toLowerCase();
        return mapPlanToTier(plan, fallbackByKey.get(key) || {});
      });
      return memberTierCache;
    } catch (error) {
      memberTierCache = [...MEMBER_TIERS];
      return memberTierCache;
    }
  })();

  return memberTierLoadPromise;
}

export function inferMemberTierFromUserInfo(userInfo = {}) {
  if (userInfo.planKey && userInfo.planName) {
    const normalizedKey = String(userInfo.planKey).toLowerCase();
    const cachedTier = memberTierCache.find((tier) => String(tier.key || tier.name).toLowerCase() === normalizedKey);
    return {
      key: normalizedKey,
      name: userInfo.planName,
      badge: userInfo.planBadge || cachedTier?.badge || '',
      summary: userInfo.planSummary || cachedTier?.summary || '统一覆盖笔记、日历、通讯录的会员能力。'
    };
  }

  const noteLimit = Number(userInfo.noteLimit || 0);
  const fileLimit = Number(userInfo.fileLimit || 0);

  const teamTier = memberTierCache.find((tier) => String(tier.key || tier.name).toLowerCase() === 'team');
  const proTier = memberTierCache.find((tier) => String(tier.key || tier.name).toLowerCase() === 'pro');
  const freeTier = memberTierCache.find((tier) => String(tier.key || tier.name).toLowerCase() === 'free');

  if (userInfo.isAdmin || noteLimit >= 500 || fileLimit >= 2000) {
    return {
      key: 'team',
      name: teamTier?.name || 'Team',
      badge: teamTier?.badge || '团队版',
      summary: teamTier?.summary || '统一覆盖笔记、日历、通讯录的团队协作与共享能力。'
    };
  }

  if (noteLimit > 100 || fileLimit > 500) {
    return {
      key: 'pro',
      name: proTier?.name || 'Pro',
      badge: proTier?.badge || '个人会员',
      summary: proTier?.summary || '统一提升笔记、日历、通讯录的配额和高级功能。'
    };
  }

  return {
    key: 'free',
    name: freeTier?.name || 'Free',
    badge: freeTier?.badge || '个人试用',
    summary: freeTier?.summary || '可使用笔记、日历、通讯录全部基础功能。'
  };
}

export const MEMBER_SECTIONS = [
  {
    title: '工作区总览',
    summary: '展示当前套餐在笔记、日历、通讯录上的统一额度、到期时间和可用高级功能。',
    meta: '会员信息应该先聚合成一个总览层，再展开到具体模块。'
  },
  {
    title: '账单与续费',
    summary: '展示订单记录、续费入口、套餐升级/降级动作和支付状态。',
    meta: '后续接支付时直接扩展，不用再改页面结构。'
  },
  {
    title: '模块聚合入口',
    summary: '把笔记、日历、通讯录当前使用情况和推荐动作聚合展示，形成面向会员的工作台。',
    meta: '适合把分散在不同模块里的数据先收敛再引导跳转。'
  },
  {
    title: '版本权益说明',
    summary: '把 Free / Pro / Team 在整套工作区里的差异写清楚，让用户知道升级后笔记、日历、通讯录分别增强什么。',
    meta: '这也是首页套餐区的延伸页。'
  }
];

export const MEMBER_WORKSPACE_MODULES = [
  {
    capabilityKey: 'notesEnabled',
    title: '笔记中心',
    summary: '查看笔记数量、空间占用、最近编辑与分享情况。',
    actions: ['新建笔记', '查看回收站', '管理分享']
  },
  {
    capabilityKey: 'calendarEnabled',
    title: '日历中心',
    summary: '查看本周日程、提醒规则、订阅源和待处理事件。',
    actions: ['新建事件', '管理提醒', '订阅同步']
  },
  {
    capabilityKey: 'contactsEnabled',
    title: '通讯录中心',
    summary: '查看联系人数量、最近跟进对象、导入导出与查重状态。',
    actions: ['新增联系人', '批量导入', '查重清理']
  }
];

export const MEMBER_QUICK_ACTIONS = [
  { title: '升级套餐', summary: '进入账单与续费区域，查看 Pro / Team 升级入口。', href: '#billing' },
  { title: '打开笔记', summary: '直接进入应用笔记工作区处理内容与分享。', href: '/app', capabilityKey: 'notesEnabled' },
  { title: '查看日历', summary: '进入日历页面处理本周安排和提醒。', href: '/calendar.html', capabilityKey: 'calendarEnabled' },
  { title: '管理联系人', summary: '进入通讯录查看客户和协作联系人。', href: '/contacts.html', capabilityKey: 'contactsEnabled' }
];
