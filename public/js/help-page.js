const guideGrid = document.getElementById('help-guide-grid');
const faqList = document.getElementById('help-faq-list');
const quickLinks = document.getElementById('help-quick-links');

const GUIDE_FALLBACK = [
  {
    icon: '📝',
    title: '创建第一篇笔记',
    summary: '了解如何创建笔记、编辑内容、使用 Markdown 语法和管理笔记分类。',
    href: '/app',
    module: 'notes'
  },
  {
    icon: '📅',
    title: '管理日程安排',
    summary: '学习创建事件、设置重复规则、添加提醒和导入外部日历。',
    href: '/calendar.html',
    module: 'calendar'
  },
  {
    icon: '👥',
    title: '管理联系人',
    summary: '掌握添加联系人、导入导出名片、查重和分组管理的技巧。',
    href: '/contacts.html',
    module: 'contacts'
  }
];

const FAQ_FALLBACK = [
  {
    title: '如何开始使用 z7Note？',
    summary: '注册账号后即可进入工作区创建笔记、安排日程和管理联系人。免费版已包含所有基础功能。'
  },
  {
    title: '数据存储在哪里？',
    summary: 'z7Note 支持自托管部署，你的所有数据都存储在自己的服务器上，完全自主可控。如果使用官方托管版本，数据则存储在云端。'
  },
  {
    title: '如何升级套餐？',
    summary: '进入会员中心查看当前套餐和升级选项。Pro 版本提供更大存储空间和高级功能，Team 版本支持团队协作。'
  },
  {
    title: '支持哪些导入导出格式？',
    summary: '笔记支持 Markdown 和 HTML 导出，日历支持 ICS 格式，联系人支持 vCard 导入导出。'
  },
  {
    title: '如何实现多设备同步？',
    summary: '登录同一账号后，你的笔记、日历和联系人会自动在所有设备间同步。也可以使用 WebDAV 或 CalDAV 连接外部客户端。'
  }
];

const QUICK_LINKS_FALLBACK = [
  { label: '💰 套餐价格', href: '/pricing' },
  { label: '📋 更新日志', href: '/changelog' },
  { label: '🚀 打开应用', href: '/app' },
  { label: '👤 会员中心', href: '/member' }
];

function renderGuides(items) {
  if (!guideGrid) return;
  guideGrid.innerHTML = items.map((item) => `
    <article class="guide-card">
      <div class="guide-icon">${item.icon}</div>
      <h3>${item.title}</h3>
      <p>${item.summary}</p>
      <a class="guide-link" href="${item.href}"${item.module ? ` data-site-module="${item.module}"` : ''}>${item.linkLabel || '查看入口 →'}</a>
    </article>
  `).join('');
}

function renderFaq(items) {
  if (!faqList) return;
  faqList.innerHTML = items.map((item) => `
    <article class="faq-item">
      <h3>${item.title}</h3>
      <p>${item.summary}</p>
    </article>
  `).join('');
}

function renderQuickLinks(items) {
  if (!quickLinks) return;
  quickLinks.innerHTML = items.map((item) => (
    `<a class="site-quick-link" href="${item.href}"${item.module ? ` data-site-module="${item.module}"` : ''}>${item.label}</a>`
  )).join('');
}

async function initHelpPage() {
  renderGuides(GUIDE_FALLBACK);
  renderFaq(FAQ_FALLBACK);
  renderQuickLinks(QUICK_LINKS_FALLBACK);

  try {
    const response = await fetch('/api/public/member-plans', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to load public member plans');
    }

    const plans = await response.json();
    const freePlan = plans.find((plan) => String(plan.planKey).toLowerCase() === 'free') || plans[0] || {};
    const teamPlan = plans.find((plan) => String(plan.planKey).toLowerCase() === 'team') || {};

    const sharedCapabilities = plans.reduce((acc, plan) => {
      Object.entries(plan.capabilities || {}).forEach(([key, enabled]) => {
        acc[key] = acc[key] || !!enabled;
      });
      return acc;
    }, {});

    const dynamicGuides = [
      {
        icon: '📝',
        title: '创建第一篇笔记',
        summary: `笔记空间按套餐配置开放，当前最高可达 ${Number(teamPlan.noteLimit || 0).toLocaleString('zh-CN')} MB，并支持分类、分享和持续编辑。`,
        href: '/app',
        module: 'notes',
        linkLabel: '进入笔记 →'
      },
      {
        icon: '📅',
        title: '管理日程安排',
        summary: sharedCapabilities.remindersEnabled
          ? `日历支持事件、待办和提醒中心；当前最高可配置 ${Number(teamPlan.eventLimit || 0).toLocaleString('zh-CN')} 个事件。`
          : '日历支持事件和待办管理，提醒与订阅能力可按套餐在后台逐项开启。',
        href: '/calendar.html',
        module: 'calendar',
        linkLabel: '进入日历 →'
      },
      {
        icon: '👥',
        title: '管理联系人',
        summary: sharedCapabilities.importExport
          ? `通讯录支持导入导出、查重和批量治理；当前最高可配置 ${Number(teamPlan.contactLimit || 0).toLocaleString('zh-CN')} 位联系人。`
          : '通讯录支持结构化联系人管理，导入导出和批量治理能力可按套餐开启。',
        href: '/contacts.html',
        module: 'contacts',
        linkLabel: '进入通讯录 →'
      }
    ];

    const dynamicFaq = [
      {
        title: '如何开始使用 z7Note？',
        summary: `注册后即可按当前套餐进入可用模块。默认套餐 ${freePlan.planName || 'Free'} 包含基础配额，模块入口会随套餐开关自动显示或隐藏。`
      },
      {
        title: '支持哪些导入导出格式？',
        summary: sharedCapabilities.importExport
          ? '已开启导入导出时，笔记、日历、通讯录都可以按模块执行数据迁移；具体入口会在对应页面直接显示。'
          : '导入导出属于可配置能力，管理员可在套餐后台为不同版本分别开启。'
      },
      {
        title: '如何实现多设备同步？',
        summary: sharedCapabilities.webdavEnabled || sharedCapabilities.caldavEnabled || sharedCapabilities.carddavEnabled
          ? '如果套餐已开启 DAV 能力，可以通过 WebDAV、CalDAV、CardDAV 接入外部客户端；未开启时相关入口会自动隐藏。'
          : '多端同步能力由套餐配置控制；管理员可以在后台单独开启 WebDAV、CalDAV、CardDAV。'
      },
      {
        title: '分享功能是否所有套餐都支持？',
        summary: sharedCapabilities.noteSharingEnabled || sharedCapabilities.fileSharingEnabled
          ? '分享能力支持按套餐拆分控制，可分别开启笔记分享、附件分享和高级分享。关闭后公开链接会立即失效。'
          : '分享能力目前由套餐后台统一控制，关闭后前端入口与公开访问都会一起收口。'
      },
      {
        title: '如何升级套餐？',
        summary: '进入会员中心查看当前套餐，也可以在后台直接调整 Free / Pro / Team 的配额与功能，例如提醒、订阅、附件、DAV、备份导出等。'
      }
    ];

    const dynamicQuickLinks = [
      { label: '💰 套餐价格', href: '/pricing' },
      { label: '📋 更新日志', href: '/changelog' },
      { label: '🚀 打开应用', href: '/app', module: 'notes' },
      { label: '📅 日历入口', href: '/calendar.html', module: 'calendar' },
      { label: '👥 通讯录入口', href: '/contacts.html', module: 'contacts' },
      { label: '👤 会员中心', href: '/member' }
    ];

    renderGuides(dynamicGuides);
    renderFaq(dynamicFaq);
    renderQuickLinks(dynamicQuickLinks);
  } catch (error) {
    console.error('加载帮助页套餐配置失败:', error);
  }
}

initHelpPage();
