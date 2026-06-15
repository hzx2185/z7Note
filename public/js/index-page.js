import {
  HOME_FEATURES,
  HOME_METRICS,
  HOME_SOCIAL_PROOF,
  HOME_CTA,
  HOME_HERO
} from '/js/site-data.js?v=20260615-release-111';

const heroMetrics = document.getElementById('hero-metrics');
const homepageFeatures = document.getElementById('homepage-features');
const homepageReasons = document.getElementById('homepage-reasons');
const homepageOperations = document.getElementById('homepage-operations');
const heroEyebrow = document.getElementById('hero-eyebrow');
const heroTitle = document.getElementById('hero-title');
const heroSubtitle = document.getElementById('hero-subtitle');
const heroActions = document.getElementById('hero-actions');
const ctaTitle = document.getElementById('cta-title');
const ctaSubtitle = document.getElementById('cta-subtitle');
const ctaButton = document.getElementById('cta-button');

const PLAN_ORDER = ['free', 'pro', 'team'];
const CAPABILITY_COPY = [
  ['notesEnabled', '📝 笔记中心', '支持 Markdown 笔记、分类归档、全文检索与持续编辑。'],
  ['calendarEnabled', '📅 日历日程', '统一管理事件、周期任务、时间安排和月视图排期。'],
  ['contactsEnabled', '👥 通讯录', '沉淀客户与协作联系人，支持结构化字段和集中管理。'],
  ['attachmentsEnabled', '📎 附件空间', '支持文件上传、归档与笔记附件协同。'],
  ['remindersEnabled', '🔔 提醒能力', '支持提醒中心、待办触达与重要事项跟进。'],
  ['importExport', '📤 数据迁移', '支持导入导出，方便迁移和周期性整理。'],
  ['webdavEnabled', '🌐 多端同步', '支持 WebDAV / DAV 客户端接入和外部工具同步。'],
  ['advancedSharing', '🔗 分享协作', '支持公开分享、高级分享能力和跨场景分发。']
];
const OPERATIONS_FALLBACK = [
  {
    title: 'Docker 发布',
    summary: '镜像按语义版本与 latest 双标签发布，适合自托管部署和回滚。',
    meta: 'linux/amd64 + linux/arm64'
  },
  {
    title: 'DAV 同步',
    summary: 'WebDAV、CalDAV、CardDAV 分别覆盖笔记文件、日历待办和系统通讯录。',
    meta: '外部客户端兼容'
  },
  {
    title: '数据治理',
    summary: '迁移脚本负责结构升级和历史数据修复，避免手工直接修改 SQLite。',
    meta: '启动自动执行'
  }
];

function formatQuota(value, unit) {
  const amount = Number(value || 0);
  if (!amount) return `0 ${unit}`;
  return `${amount.toLocaleString('zh-CN')} ${unit}`;
}

function buildDynamicMetrics(plans) {
  const moduleCount = new Set();
  const advancedCount = new Set();
  const highestFileLimit = plans.reduce((max, plan) => Math.max(max, Number(plan.fileLimit || 0)), 0);

  plans.forEach((plan) => {
    const capabilities = plan.capabilities || {};
    if (capabilities.notesEnabled) moduleCount.add('notes');
    if (capabilities.calendarEnabled) moduleCount.add('calendar');
    if (capabilities.contactsEnabled) moduleCount.add('contacts');
    if (capabilities.remindersEnabled) moduleCount.add('reminders');
    if (capabilities.noteSharingEnabled || capabilities.fileSharingEnabled) moduleCount.add('sharing');

    [
      'importExport',
      'webdavEnabled',
      'caldavEnabled',
      'carddavEnabled',
      'backupExportEnabled',
      'calendarSubscriptionsEnabled'
    ].forEach((key) => {
      if (capabilities[key]) advancedCount.add(key);
    });
  });

  return [
    {
      value: `${moduleCount.size} 合 1`,
      description: '笔记、日历、联系人、提醒、分享统一归于一个工作区'
    },
    {
      value: `${plans.length} 档套餐`,
      description: '首页套餐能力与后台配置实时同步，不再依赖静态文案'
    },
    {
      value: formatQuota(highestFileLimit, 'MB'),
      description: `当前最高附件空间；已启用 ${advancedCount.size} 项高级能力`
    }
  ];
}

function buildDynamicFeatures(plans) {
  const capabilities = {};
  plans.forEach((plan) => {
    Object.entries(plan.capabilities || {}).forEach(([key, enabled]) => {
      capabilities[key] = capabilities[key] || !!enabled;
    });
  });

  return CAPABILITY_COPY.filter(([key]) => capabilities[key]).slice(0, 6).map(([key, title, summary]) => ({
    key,
    title,
    summary
  }));
}

function buildDynamicReasons(plans) {
  const highestNote = plans.reduce((max, plan) => Math.max(max, Number(plan.noteLimit || 0)), 0);
  const highestEvent = plans.reduce((max, plan) => Math.max(max, Number(plan.eventLimit || 0)), 0);
  const highestContact = plans.reduce((max, plan) => Math.max(max, Number(plan.contactLimit || 0)), 0);
  const proPlan = plans.find((plan) => String(plan.planKey).toLowerCase() === 'pro');
  const teamPlan = plans.find((plan) => String(plan.planKey).toLowerCase() === 'team');

  return [
    {
      icon: '📦',
      title: '套餐配置实时生效',
      summary: '首页、定价页和后台使用同一份套餐配置，功能开关与配额保持一致。'
    },
    {
      icon: '📚',
      title: '统一容量规划',
      summary: `当前最高支持 ${formatQuota(highestNote, 'MB')} 笔记空间、${formatQuota(highestEvent, '项')} 日历事件、${formatQuota(highestContact, '项')} 联系人。`
    },
    {
      icon: '🔄',
      title: '同步与集成能力',
      summary: proPlan?.capabilities?.webdavEnabled || teamPlan?.capabilities?.webdavEnabled
        ? '可按套餐开启 WebDAV、CalDAV、CardDAV、提醒与订阅能力。'
        : '同步与集成能力可在后台按套餐逐项开启，适合渐进式开放功能。'
    },
    {
      icon: '🧩',
      title: '模块按需开放',
      summary: '笔记、日历、待办、通讯录、附件、分享等入口都会跟随套餐能力自动收口。'
    }
  ];
}

function renderMetrics(metrics) {
  if (!heroMetrics) return;
  heroMetrics.innerHTML = metrics.map((metric) => `
    <div class="metric">
      <strong>${metric.value}</strong>
      <span>${metric.description}</span>
    </div>
  `).join('');
}

function renderFeatures(features) {
  if (!homepageFeatures) return;
  homepageFeatures.innerHTML = features.map((feature) => `
    <article class="feature-card">
      <h3>${feature.title}</h3>
      <p>${feature.summary}</p>
    </article>
  `).join('');
}

function renderReasons(reasons) {
  if (!homepageReasons) return;
  homepageReasons.innerHTML = reasons.map((reason) => `
    <div class="reason-card">
      <div class="reason-icon">${reason.icon}</div>
      <div class="reason-content">
        <h3>${reason.title}</h3>
        <p>${reason.summary}</p>
      </div>
    </div>
  `).join('');
}

function renderOperations(items) {
  if (!homepageOperations) return;
  homepageOperations.innerHTML = items.map((item) => `
    <article class="operation-card">
      <strong>${item.title}</strong>
      <p>${item.summary}</p>
      <span>${item.meta}</span>
    </article>
  `).join('');
}

if (heroEyebrow && HOME_HERO) {
  heroEyebrow.textContent = HOME_HERO.eyebrow;
}

if (heroTitle && HOME_HERO) {
  heroTitle.textContent = HOME_HERO.title;
}

if (heroSubtitle && HOME_HERO) {
  heroSubtitle.textContent = HOME_HERO.subtitle;
}

if (heroActions && HOME_HERO) {
  heroActions.innerHTML = `
    <a class="btn btn-primary" href="/app">${HOME_HERO.actions.primary}</a>
    <a class="btn btn-secondary" href="/changelog">${HOME_HERO.actions.secondary}</a>
  `;
}

if (ctaTitle && HOME_CTA) {
  ctaTitle.textContent = HOME_CTA.title;
}

if (ctaSubtitle && HOME_CTA) {
  ctaSubtitle.textContent = HOME_CTA.subtitle;
}

if (ctaButton && HOME_CTA) {
  ctaButton.textContent = HOME_CTA.button;
}

renderMetrics(HOME_METRICS);
renderFeatures(HOME_FEATURES);
renderReasons(HOME_SOCIAL_PROOF?.reasons || []);
renderOperations(OPERATIONS_FALLBACK);

async function loadHomepagePlanContent() {
  try {
    const response = await fetch('/api/public/member-plans', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to load public member plans');
    }

    const plans = await response.json();
    const sortedPlans = [...plans].sort((a, b) => (
      PLAN_ORDER.indexOf(String(a.planKey || '').toLowerCase()) - PLAN_ORDER.indexOf(String(b.planKey || '').toLowerCase())
    ));

    renderMetrics(buildDynamicMetrics(sortedPlans));
    renderFeatures(buildDynamicFeatures(sortedPlans));
    renderReasons(buildDynamicReasons(sortedPlans));
    renderOperations([
      {
        title: '同步能力按套餐开放',
        summary: 'WebDAV、CalDAV、CardDAV、日历订阅和备份导出都跟随后台套餐开关自动收口。',
        meta: `${sortedPlans.length} 档套餐同步配置`
      },
      {
        title: '发布版本可追踪',
        summary: '更新日志、package 版本和 Docker 标签保持一致，方便判断当前部署是否需要升级。',
        meta: 'semantic version + latest'
      },
      {
        title: '数据修复走迁移',
        summary: '历史数据治理通过迁移脚本执行；例如重复实例影子事件会在启动时自动清理并同步删除记录。',
        meta: 'schema migration'
      }
    ]);
  } catch (error) {
    console.error('加载首页套餐配置失败:', error);
  }
}

loadHomepagePlanContent();
