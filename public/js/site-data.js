export const HOME_METRICS = [
  {
    value: '自托管',
    description: '数据完全由您自主掌控，无隐私泄露与数据丢失风险'
  },
  {
    value: '无扰打开',
    description: '从日历打开笔记不会因为空同步刷新最后更新时间'
  },
  {
    value: '双标签镜像',
    description: '发布时同步推送语义版本与 latest，便于升级和回滚'
  }
];

export const HOME_FEATURES = [
  {
    title: '📝 更新时间更准确',
    summary: '打开笔记、切换页面或重复同步相同内容时，不再把最后更新时间错误推进。'
  },
  {
    title: '⚡ 同步写入更克制',
    summary: '服务端识别无实质变化的同步请求，跳过写库、历史记录和广播。'
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
    summary: '同步陈旧版本元数据，清理无效更新路径，让镜像与源码保持更易维护的状态。'
  }
];

export const HOME_HERO = {
  eyebrow: '全栈自托管笔记工作区',
  title: '更准确记录修改时间的自托管笔记工作区',
  subtitle: '将笔记、日历、联系人、提醒与分享整合为一个轻量、安全、可自托管的个人与团队协作空间。打开和浏览不会被误判为编辑，真正的修改才会进入更新时间线。',
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
      title: '编辑记录更可信',
      summary: '无变化保存会被服务端识别并跳过，更新时间更接近真实编辑行为。'
    },
    {
      icon: '🌐',
      title: '开源免费使用',
      summary: 'MIT 协议开源，无商业限制，可自由定制和二次开发。'
    }
  ]
};

export const HOME_CTA = {
  title: '准备好开始了吗？',
  subtitle: '立即体验 z7Note，打造属于您的专属高效自托管工作区。',
  button: '免费试用'
};
