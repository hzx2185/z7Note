const guideGrid = document.getElementById('help-guide-grid');
const faqList = document.getElementById('help-faq-list');
const quickLinks = document.getElementById('help-quick-links');
const opsGrid = document.getElementById('help-ops-grid');

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
    summary: '掌握添加联系人、导入导出名片、查重、合并和 CardDAV 多端同步。',
    href: '/contacts.html',
    module: 'contacts'
  },
  {
    icon: '🔄',
    title: '连接 DAV 客户端',
    summary: '使用 WebDAV 同步笔记文件，用 CalDAV 同步日历待办，用 CardDAV 同步系统通讯录。',
    href: '/member',
    module: 'workspace'
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
  },
  {
    title: 'iPhone 通讯录同步只看到姓名怎么办？',
    summary: '新版已兼容 iOS / macOS 通讯录的 Apple 分组 vCard 字段，例如 item1.TEL。升级后重新同步即可同步电话号码。'
  },
  {
    title: '笔记列表为什么默认不显示分类？',
    summary: '笔记列表默认按最后修改时间倒序显示，便于快速回到最近内容。需要分类视图时点击顶部“分类”按钮，再点分类名展开。'
  }
];

const QUICK_LINKS_FALLBACK = [
  { label: '💰 套餐价格', href: '/pricing' },
  { label: '📋 更新日志', href: '/changelog' },
  { label: '🚀 打开应用', href: '/app' },
  { label: '👤 会员中心', href: '/member' }
];
const OPS_FALLBACK = [
  {
    title: '升级容器',
    summary: '镜像部署使用固定服务端更新命令，推荐先拉取新镜像，再由 Compose 重建并启动容器。',
    steps: ['docker compose pull', 'docker compose up -d', '确认 /health 返回 200']
  },
  {
    title: 'DAV 客户端同步',
    summary: '外部客户端分别连接 /webdav/、/caldav/、/carddav/。遇到重复日历实例时，升级后会由迁移和同步删除记录自动收口。',
    steps: ['重新同步账户', '确认客户端收到删除项', '必要时移除并重加账户']
  },
  {
    title: '备份与恢复',
    summary: '升级前保留 data/ 与 logs/；数据库结构变化由迁移脚本在启动时自动执行，不建议手动改 SQLite 表结构。',
    steps: ['备份 data/z7note.db', '保留 data/uploads', '启动后查看日志确认迁移完成']
  }
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

function renderOperations(items) {
  if (!opsGrid) return;
  opsGrid.innerHTML = items.map((item) => `
    <article class="help-ops-card">
      <h3>${item.title}</h3>
      <p>${item.summary}</p>
      <ol>
        ${(item.steps || []).map((step) => `<li>${step}</li>`).join('')}
      </ol>
    </article>
  `).join('');
}

async function initHelpPage() {
  renderGuides(GUIDE_FALLBACK);
  renderFaq(FAQ_FALLBACK);
  renderQuickLinks(QUICK_LINKS_FALLBACK);
  renderOperations(OPS_FALLBACK);

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
          ? `通讯录支持导入导出、查重、合并和 CardDAV 同步；当前最高可配置 ${Number(teamPlan.contactLimit || 0).toLocaleString('zh-CN')} 位联系人。`
          : '通讯录支持结构化联系人管理和 CardDAV 同步，导入导出与批量治理能力可按套餐开启。',
        href: '/contacts.html',
        module: 'contacts',
        linkLabel: '进入通讯录 →'
      },
      {
        icon: '🔄',
        title: '连接 DAV 客户端',
        summary: '外部客户端统一使用账户密码登录：WebDAV 连接笔记文件，CalDAV 连接系统日历，CardDAV 连接系统通讯录。',
        href: '/member',
        module: 'workspace',
        linkLabel: '查看入口 →'
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
          ? '如果套餐已开启 DAV 能力，可以通过 WebDAV、CalDAV、CardDAV 接入外部客户端；推荐路径分别是 /webdav/、/caldav/、/carddav/。'
          : '多端同步能力由套餐配置控制；管理员可以在后台单独开启 WebDAV、CalDAV、CardDAV。'
      },
      {
        title: 'iPhone 通讯录同步只看到姓名怎么办？',
        summary: '请先升级到包含 2026-04-30 修复的版本。系统已兼容 iOS / macOS 通讯录的 item1.TEL 分组电话字段，升级后重新同步即可。'
      },
      {
        title: '笔记分类按钮如何使用？',
        summary: '笔记列表默认只显示最近修改内容。点击顶部“分类”按钮会显示分类列表，分类默认折叠；再次点击“分类”按钮可回到普通列表。'
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
      },
      {
        title: '农历生日为什么以前会显示两次？',
        summary: '旧版本可能把 CalDAV 客户端回写的重复实例保存成独立事件。1.0.8 起会过滤并清理这类影子事件，同时通过 deleted_items 通知外部客户端删除。'
      }
    ];

    const dynamicQuickLinks = [
      { label: '💰 套餐价格', href: '/pricing' },
      { label: '📋 更新日志', href: '/changelog' },
      { label: '🚀 打开应用', href: '/app', module: 'notes' },
      { label: '📅 日历入口', href: '/calendar.html', module: 'calendar' },
      { label: '👥 通讯录入口', href: '/contacts.html', module: 'contacts' },
      { label: '🔄 DAV 同步', href: '/member', module: 'workspace' },
      { label: '👤 会员中心', href: '/member' }
    ];

    renderGuides(dynamicGuides);
    renderFaq(dynamicFaq);
    renderQuickLinks(dynamicQuickLinks);
    renderOperations([
      {
        title: '升级容器',
        summary: 'Docker 部署推荐使用固定 Compose 更新流程，避免浏览器传入任意更新命令。',
        steps: ['拉取语义版本或 latest 镜像', 'docker compose up -d 重建服务', '检查 /health 和后台版本状态']
      },
      {
        title: '同步客户端排查',
        summary: sharedCapabilities.caldavEnabled || sharedCapabilities.carddavEnabled
          ? '套餐已支持 DAV 能力时，外部客户端可以重新同步获取删除记录和最新数据。'
          : 'DAV 能力可在后台按套餐开启；关闭时前端入口与服务端接口会同步收口。',
        steps: ['检查套餐是否开启 DAV', '确认客户端地址和用户名密码', '必要时移除客户端账户后重新添加']
      },
      {
        title: '迁移与备份',
        summary: '结构调整和历史数据清理都通过迁移执行，升级前保留 data 目录即可降低回滚风险。',
        steps: ['备份 data/z7note.db 与 uploads', '启动后查看迁移日志', '发现异常先恢复备份再排查']
      }
    ]);
  } catch (error) {
    console.error('加载帮助页套餐配置失败:', error);
  }
}

initHelpPage();
