export const HOME_METRICS = [
  {
    value: '1.1.1',
    description: '当前最新版本，后台支持显示并单独检测远程 Docker 镜像与 GitHub 源码版本'
  },
  {
    value: '多端编辑',
    description: '列表切换、标题编辑、内容保存围绕同一编辑器状态收口'
  },
  {
    value: '双标签镜像',
    description: '发布时同步推送语义版本与 latest，便于升级和回滚'
  }
];

export const HOME_FEATURES = [
  {
    title: '📝 稳定笔记编辑',
    summary: '点击列表标题会可靠切换内容，编辑器初始化失败也会显示明确状态。'
  },
  {
    title: '⚡ 快速切换保护',
    summary: '快速连续切换多篇笔记时，过期编辑器初始化会被丢弃，避免标题和正文错位。'
  },
  {
    title: '📅 日历与提醒',
    summary: '事件、待办、重复日程、订阅和提醒继续服务于同一个自托管工作区。'
  },
  {
    title: '🔧 套餐可配',
    summary: '配额、功能开关、模块入口都可在后台按套餐统一配置。'
  },
  {
    title: '🔗 同步与分享',
    summary: 'WebDAV、CalDAV、CardDAV、公开分享和附件能力可按部署需要逐步开放。'
  },
  {
    title: '🧹 发布包更干净',
    summary: '清理无用调试代码和系统临时文件，让镜像与源码保持更易维护的状态。'
  }
];

export const HOME_HERO = {
  eyebrow: 'z7Note 1.1.1 已发布',
  title: '更稳定好用的自托管笔记工作区',
  subtitle: '本次发布在后台管理中新增了独立的 Docker 镜像及 GitHub 源码版本检测，并对版本状态渲染逻辑进行了完善。',
  actions: {
    primary: '立即开始',
    secondary: '查看更新日志'
  }
};

export const HOME_SOCIAL_PROOF = {
  title: '为什么选择 z7Note？',
  reasons: [
    {
      icon: '🔒',
      title: '数据自主可控',
      summary: '完全自托管，你的数据库你自己掌控，无需担心数据泄露风险。'
    },
    {
      icon: '🚀',
      title: '可靠发布升级',
      summary: '版本号、更新日志、缓存标识和 Docker 标签统一推进，升级状态更容易确认。'
    },
    {
      icon: '✍️',
      title: '编辑体验更稳',
      summary: '编辑器等待 CodeMirror 就绪后再初始化，失败时不再静默空白。'
    },
    {
      icon: '🌐',
      title: '开源免费使用',
      summary: 'MIT 协议开源，无商业限制，可自由定制和二次开发。'
    }
  ]
};

export const HOME_CTA = {
  title: '升级到 1.1.1',
  subtitle: '升级到最新版本以获得最新的后台独立版本探测与自动更新参考目标。',
  button: '打开应用'
};
