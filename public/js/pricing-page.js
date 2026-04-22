import { MEMBER_TIERS, loadMemberTiers } from '/js/member-data.js';

const pricingGrid = document.getElementById('pricing-grid');
const compareHead = document.getElementById('pricing-compare-head');
const compareBody = document.getElementById('pricing-compare-body');
const heroCopy = document.getElementById('pricing-hero-copy');
const compareCopy = document.getElementById('pricing-compare-copy');
const pricingCategoryTabs = document.getElementById('pricing-category-tabs');
const pricingRedeemModal = document.getElementById('pricing-redeem-modal');
const pricingRedeemInput = document.getElementById('pricing-redeem-input');
const pricingRedeemBtn = document.getElementById('pricing-redeem-btn');
const pricingRedeemMessage = document.getElementById('pricing-redeem-message');

const PLAN_ORDER = ['free', 'pro', 'team'];
const COMPARE_CATEGORIES = [
  {
    key: 'quota',
    label: '统一配额',
    rows: [
      ['笔记空间', (plan) => formatQuota(plan.noteLimit, 'MB')],
      ['附件空间', (plan) => formatQuota(plan.fileLimit, 'MB')],
      ['日历事件', (plan) => formatQuota(plan.eventLimit, '项')],
      ['待办数量', (plan) => formatQuota(plan.todoLimit, '项')],
      ['联系人数量', (plan) => formatQuota(plan.contactLimit, '项')]
    ]
  },
  {
    key: 'workspace',
    label: '核心模块',
    rows: [
      ['笔记模块', 'notesEnabled'],
      ['日历模块', 'calendarEnabled'],
      ['待办模块', 'todosEnabled'],
      ['通讯录模块', 'contactsEnabled'],
      ['附件上传', 'attachmentsEnabled'],
      ['附件管理', 'attachmentManageEnabled'],
      ['全局搜索', 'searchEnabled']
    ]
  },
  {
    key: 'sync',
    label: '同步分享',
    rows: [
      ['笔记分享', 'noteSharingEnabled'],
      ['附件分享', 'fileSharingEnabled'],
      ['高级分享', 'advancedSharing'],
      ['导入导出', 'importExport'],
      ['WebDAV', 'webdavEnabled'],
      ['CalDAV', 'caldavEnabled'],
      ['CardDAV', 'carddavEnabled']
    ]
  },
  {
    key: 'advanced',
    label: '高级能力',
    rows: [
      ['提醒中心', 'remindersEnabled'],
      ['邮件提醒', 'emailRemindersEnabled'],
      ['浏览器提醒', 'browserRemindersEnabled'],
      ['CalDAV 提醒', 'caldavRemindersEnabled'],
      ['日历订阅', 'calendarSubscriptionsEnabled'],
      ['备份导出', 'backupExportEnabled'],
      ['团队协作', 'teamWorkspace'],
      ['管理工作台', 'adminWorkbench']
    ]
  }
];

let activeCompareCategory = 'quota';

function formatQuota(value, unit) {
  const amount = Number(value || 0);
  if (!amount) return `0 ${unit}`;
  return `${amount.toLocaleString('zh-CN')} ${unit}`;
}

function getLoadedTiers() {
  return window.__memberTiers || MEMBER_TIERS;
}

function renderPlanCard(plan) {
  const loadedTiers = getLoadedTiers();
  const tier = loadedTiers.find((item) => item.name.toLowerCase() === String(plan.planName || '').toLowerCase())
    || loadedTiers.find((item) => String(item.key || item.name).toLowerCase() === String(plan.planKey || '').toLowerCase())
    || loadedTiers[0]
    || MEMBER_TIERS[0];

  const quotaLine = [
    `${formatQuota(plan.noteLimit, 'MB')} 笔记空间`,
    `${formatQuota(plan.fileLimit, 'MB')} 附件空间`,
    `${formatQuota(plan.eventLimit, '项')} 日历`,
    `${formatQuota(plan.todoLimit, '项')} 待办`,
    `${formatQuota(plan.contactLimit, '项')} 联系人`
  ].join(' / ');

  return `
    <article class="pricing-card${tier.featured ? ' featured' : ''}">
      <div class="tier-header">
        <div class="tier-badge">${plan.planBadge || tier.badge}</div>
        <h3 class="tier-name">${plan.planName || tier.name}</h3>
        <div class="${tier.price === '¥0' ? 'price-free' : 'price'}">
          ${tier.price === '¥0' ? '免费' : tier.price} <small>${tier.period}</small>
        </div>
      </div>
      <div class="tier-quota">${quotaLine}</div>
      <div class="feature-list">
        ${(Array.isArray(plan.features) ? plan.features : []).map((feature) => `<div>${feature}</div>`).join('')}
      </div>
      <div class="tier-cta">
        <button class="btn btn-${tier.ctaVariant}" type="button" data-plan-action="${plan.planKey || tier.key}">${tier.key === 'free' ? '立即体验' : '立即兑换 / 升级'}</button>
      </div>
    </article>
  `;
}

function renderCompareTable(plans) {
  if (!compareHead || !compareBody) return;
  const selectedCategory = COMPARE_CATEGORIES.find((item) => item.key === activeCompareCategory) || COMPARE_CATEGORIES[0];

  compareHead.innerHTML = `
    <th>功能</th>
    ${plans.map((plan) => `<th>${plan.planName || plan.planKey}</th>`).join('')}
  `;

  const rows = selectedCategory.rows.map(([label, formatterOrKey]) => {
    if (typeof formatterOrKey === 'function') {
      return `
      <tr>
        <td>${label}</td>
        ${plans.map((plan) => `<td>${formatterOrKey(plan)}</td>`).join('')}
      </tr>
    `;
    }

    return `
      <tr>
        <td>${label}</td>
        ${plans.map((plan) => {
          const enabled = !!plan.capabilities?.[formatterOrKey];
          return `<td class="${enabled ? 'check' : 'empty'}">${enabled ? '✓' : '—'}</td>`;
        }).join('')}
      </tr>
    `;
  });

  compareBody.innerHTML = rows.join('');
}

function renderCategoryTabs(plans) {
  if (!pricingCategoryTabs) return;
  pricingCategoryTabs.innerHTML = COMPARE_CATEGORIES.map((category) => `
    <button class="pricing-category-tab${category.key === activeCompareCategory ? ' active' : ''}" type="button" data-compare-category="${category.key}">
      ${category.label}
    </button>
  `).join('');

  pricingCategoryTabs.querySelectorAll('[data-compare-category]').forEach((button) => {
    button.addEventListener('click', () => {
      activeCompareCategory = button.getAttribute('data-compare-category') || 'quota';
      renderCategoryTabs(plans);
      renderCompareTable(plans);
    });
  });
}

function openRedeemModal(planKey = '') {
  if (!pricingRedeemModal) return;
  pricingRedeemModal.classList.remove('site-hidden');
  document.body.classList.add('modal-open');
  if (pricingRedeemInput) {
    pricingRedeemInput.value = '';
    pricingRedeemInput.dataset.planKey = planKey;
    pricingRedeemInput.focus();
  }
  if (pricingRedeemMessage) {
    pricingRedeemMessage.textContent = planKey
      ? `准备兑换 ${String(planKey).toUpperCase()} 套餐，输入兑换码后立即生效。`
      : '支持 Pro / Team 套餐与统一配额兑换。';
  }
}

function closeRedeemModal() {
  if (!pricingRedeemModal) return;
  pricingRedeemModal.classList.add('site-hidden');
  document.body.classList.remove('modal-open');
}

async function redeemCode() {
  const code = pricingRedeemInput?.value?.trim();
  if (!code) {
    if (pricingRedeemMessage) pricingRedeemMessage.textContent = '请输入兑换码';
    return;
  }

  pricingRedeemBtn.disabled = true;
  pricingRedeemMessage.textContent = '正在兑换...';

  try {
    const response = await fetch('/api/member/redeem-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code })
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login.html';
        return;
      }
      throw new Error(data.error || '兑换失败');
    }
    pricingRedeemMessage.textContent = data.message || '兑换成功';
    setTimeout(() => {
      window.location.href = '/member';
    }, 600);
  } catch (error) {
    pricingRedeemMessage.textContent = error.message || '兑换失败';
  } finally {
    pricingRedeemBtn.disabled = false;
  }
}

async function loadPricing() {
  const loadedTiers = await loadMemberTiers().catch(() => MEMBER_TIERS);
  window.__memberTiers = loadedTiers;

  const fallbackPlans = loadedTiers.map((tier, index) => ({
    planKey: PLAN_ORDER[index] || tier.name.toLowerCase(),
    planName: tier.name,
    planBadge: tier.badge,
    planSummary: tier.target,
    noteLimit: index === 0 ? 100 : (index === 1 ? 300 : 1000),
    fileLimit: index === 0 ? 100 : (index === 1 ? 1500 : 5000),
    eventLimit: index === 0 ? 200 : (index === 1 ? 2000 : 10000),
    todoLimit: index === 0 ? 300 : (index === 1 ? 3000 : 12000),
    contactLimit: index === 0 ? 200 : (index === 1 ? 2000 : 10000),
    features: tier.features,
    capabilities: {}
  }));

  try {
    const response = await fetch('/api/public/member-plans', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to load public member plans');
    }

    const plans = await response.json();
    const sortedPlans = [...plans].sort((a, b) => (
      PLAN_ORDER.indexOf(String(a.planKey || '').toLowerCase()) - PLAN_ORDER.indexOf(String(b.planKey || '').toLowerCase())
    ));

    if (pricingGrid) {
      pricingGrid.innerHTML = sortedPlans.map(renderPlanCard).join('');
      pricingGrid.querySelectorAll('[data-plan-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const planKey = button.getAttribute('data-plan-action') || '';
          if (String(planKey).toLowerCase() === 'free') {
            window.location.href = '/app';
            return;
          }
          openRedeemModal(planKey);
        });
      });
    }
    renderCategoryTabs(sortedPlans);
    renderCompareTable(sortedPlans);

    if (heroCopy) {
      heroCopy.textContent = '从个人免费版到团队专业版，页面展示内容直接读取当前后台套餐配置。';
    }
    if (compareCopy) {
      compareCopy.textContent = '以下对比表已同步后台套餐配额与功能开关。';
    }
  } catch (error) {
    if (pricingGrid) {
      pricingGrid.innerHTML = fallbackPlans.map(renderPlanCard).join('');
      pricingGrid.querySelectorAll('[data-plan-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const planKey = button.getAttribute('data-plan-action') || '';
          if (String(planKey).toLowerCase() === 'free') {
            window.location.href = '/app';
            return;
          }
          openRedeemModal(planKey);
        });
      });
    }
    renderCategoryTabs(fallbackPlans);
    renderCompareTable(fallbackPlans);
  }
}

document.getElementById('pricing-redeem-close-btn')?.addEventListener('click', closeRedeemModal);
pricingRedeemModal?.addEventListener('click', (event) => {
  if (event.target === pricingRedeemModal) closeRedeemModal();
});
pricingRedeemBtn?.addEventListener('click', redeemCode);
pricingRedeemInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    redeemCode();
  }
});

loadPricing();
