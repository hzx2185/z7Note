import {
  MEMBER_TIERS,
  loadMemberTiers,
  MEMBER_SECTIONS,
  MEMBER_WORKSPACE_MODULES,
  MEMBER_QUICK_ACTIONS,
  inferMemberTierFromUserInfo
} from '/js/member-data.js';

const dashboardLoggedIn = document.getElementById('dashboard-logged-in');
const dashboardLoggedOut = document.getElementById('dashboard-logged-out');
const tiersGrid = document.getElementById('tiers-grid');
const memberPublicSections = document.getElementById('member-public-sections');
const redeemCodeInput = document.getElementById('redeem-code-input');
const redeemCodeBtn = document.getElementById('redeem-code-btn');
const redeemCodeMessage = document.getElementById('redeem-code-message');
const memberTierCategories = document.getElementById('member-tier-categories');
const memberRedeemModal = document.getElementById('member-redeem-modal');
const memberRedeemModalInput = document.getElementById('member-redeem-modal-input');
const memberRedeemModalBtn = document.getElementById('member-redeem-modal-btn');
const memberRedeemModalMessage = document.getElementById('member-redeem-modal-message');
const memberOpenRedeemBtn = document.getElementById('member-open-redeem-btn');
const memberLogoutBtn = document.getElementById('member-logout-btn');
const upgradeBtn = document.getElementById('upgrade-btn');
const memberEmailBtn = document.getElementById('member-email-btn');
const memberPasswordBtn = document.getElementById('member-password-btn');
const member2FABtn = document.getElementById('member-2fa-btn');

const TIER_CATEGORY_LABELS = {
  all: '全部',
  starter: '适用对象',
  quota: '统一配额',
  capability: '核心能力'
};

let activeTierCategory = 'all';

if (memberPublicSections) {
  memberPublicSections.innerHTML = MEMBER_SECTIONS.map((section) => `
    <article class="public-section-card">
      <h3>${section.title}</h3>
      <p>${section.summary}</p>
      <span>${section.meta}</span>
    </article>
  `).join('');
}

function renderTiers(tiers) {
  if (!tiersGrid) return;
  tiersGrid.innerHTML = tiers.map((tier) => {
    const features = Array.isArray(tier.features) ? tier.features : [];
    const filteredFeatures = activeTierCategory === 'all'
      ? features
      : activeTierCategory === 'starter'
        ? [tier.target, tier.badge, tier.quota]
        : activeTierCategory === 'quota'
          ? [tier.quota, ...features.slice(0, 2)]
          : features.slice(0, 3);

    return `
    <article class="tier-card${tier.featured ? ' featured' : ''}">
      <div class="tier-header">
        <div class="tier-badge">${tier.badge}</div>
        <h3 class="tier-name">${tier.name}</h3>
        <div class="tier-price">${tier.price === '¥0' ? '免费' : tier.price} <small>${tier.period}</small></div>
      </div>
      <div class="feature-list">
        ${filteredFeatures.map((feature) => `<div>${feature}</div>`).join('')}
      </div>
      <div class="tier-cta">
        <button class="btn btn-${tier.ctaVariant || 'secondary'}" type="button" data-tier-action="${tier.key}">${tier.key === 'free' ? '立即体验' : '立即兑换 / 升级'}</button>
      </div>
    </article>
  `;
  }).join('');

  tiersGrid.querySelectorAll('[data-tier-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const planKey = button.getAttribute('data-tier-action');
      if (planKey === 'free') {
        window.location.href = '/app';
        return;
      }
      openRedeemModal(planKey);
    });
  });
}

function renderTierCategories() {
  if (!memberTierCategories) return;
  memberTierCategories.innerHTML = Object.entries(TIER_CATEGORY_LABELS).map(([key, label]) => `
    <button class="pricing-category-tab${key === activeTierCategory ? ' active' : ''}" type="button" data-tier-category="${key}">${label}</button>
  `).join('');

  memberTierCategories.querySelectorAll('[data-tier-category]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTierCategory = button.getAttribute('data-tier-category') || 'all';
      renderTierCategories();
      renderTiers(window.__memberPageTiers || MEMBER_TIERS);
    });
  });
}

async function redeemMemberCode() {
  const useModal = memberRedeemModal && !memberRedeemModal.classList.contains('site-hidden');
  const primaryInput = useModal ? memberRedeemModalInput : redeemCodeInput;
  const primaryButton = useModal ? memberRedeemModalBtn : redeemCodeBtn;
  const primaryMessage = useModal ? memberRedeemModalMessage : redeemCodeMessage;
  const code = primaryInput?.value?.trim();
  if (!code) {
    if (primaryMessage) primaryMessage.textContent = '请输入兑换码';
    return;
  }

  if (primaryButton) primaryButton.disabled = true;
  if (primaryMessage) primaryMessage.textContent = '正在兑换...';
  if (redeemCodeMessage && primaryMessage !== redeemCodeMessage) redeemCodeMessage.textContent = '正在兑换...';

  try {
    const response = await fetch('/api/member/redeem-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '兑换失败');
    }
    if (primaryMessage) primaryMessage.textContent = data.message || '兑换成功';
    if (redeemCodeMessage && primaryMessage !== redeemCodeMessage) redeemCodeMessage.textContent = data.message || '兑换成功';
    setTimeout(() => location.reload(), 600);
  } catch (error) {
    if (primaryMessage) primaryMessage.textContent = error.message || '兑换失败';
    if (redeemCodeMessage && primaryMessage !== redeemCodeMessage) redeemCodeMessage.textContent = error.message || '兑换失败';
  } finally {
    if (primaryButton) primaryButton.disabled = false;
  }
}

function openRedeemModal(planKey = '') {
  if (!memberRedeemModal) return;
  memberRedeemModal.classList.remove('site-hidden');
  document.body.classList.add('modal-open');
  if (memberRedeemModalInput) {
    memberRedeemModalInput.value = '';
    memberRedeemModalInput.focus();
    memberRedeemModalInput.dataset.planKey = planKey;
  }
  if (memberRedeemModalMessage) {
    memberRedeemModalMessage.textContent = planKey && planKey !== 'free'
      ? `准备兑换 ${String(planKey).toUpperCase()} 套餐，输入兑换码后立即生效。`
      : '支持 Pro / Team 套餐兑换与统一配额升级。';
  }
}

function closeRedeemModal() {
  if (!memberRedeemModal) return;
  memberRedeemModal.classList.add('site-hidden');
  document.body.classList.remove('modal-open');
}

function openModalById(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('site-hidden');
  document.body.classList.add('modal-open');
}

function closeModalById(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('site-hidden');
  if (!document.querySelector('.modal-shell:not(.site-hidden)')) {
    document.body.classList.remove('modal-open');
  }
}

function setMessage(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function sendBindCode() {
  const email = document.getElementById('member-email-input')?.value?.trim();
  const btn = document.getElementById('member-email-send-btn');
  if (!email || !email.includes('@')) {
    setMessage('member-email-message', '请输入正确的邮箱地址');
    return;
  }
  btn.disabled = true;
  setMessage('member-email-message', '正在发送验证码...');
  try {
    const res = await fetch('/api/send-bind-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '发送失败');
    setMessage('member-email-message', '验证码已发送，请检查邮箱');
  } catch (error) {
    setMessage('member-email-message', error.message || '发送失败');
  } finally {
    btn.disabled = false;
  }
}

async function verifyBindCode() {
  const email = document.getElementById('member-email-input')?.value?.trim();
  const token = document.getElementById('member-email-code-input')?.value?.trim();
  const btn = document.getElementById('member-email-verify-btn');
  if (!email || !token) {
    setMessage('member-email-message', '请填写邮箱和验证码');
    return;
  }
  btn.disabled = true;
  setMessage('member-email-message', '正在验证...');
  try {
    const res = await fetch('/api/verify-bind-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, token })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '绑定失败');
    setMessage('member-email-message', '邮箱绑定成功，正在刷新...');
    setTimeout(() => window.location.reload(), 700);
  } catch (error) {
    setMessage('member-email-message', error.message || '绑定失败');
    btn.disabled = false;
  }
}

async function submitPasswordChange() {
  const oldPass = document.getElementById('member-old-password')?.value?.trim();
  const newPass = document.getElementById('member-new-password')?.value?.trim();
  const confirmPass = document.getElementById('member-confirm-password')?.value?.trim();
  const btn = document.getElementById('member-password-submit-btn');
  if (!oldPass || !newPass || !confirmPass) {
    setMessage('member-password-message', '请填写完整密码信息');
    return;
  }
  if (newPass.length < 6) {
    setMessage('member-password-message', '新密码至少需要 6 位');
    return;
  }
  if (newPass !== confirmPass) {
    setMessage('member-password-message', '两次输入的新密码不一致');
    return;
  }
  btn.disabled = true;
  setMessage('member-password-message', '正在修改密码...');
  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ oldPass, newPass })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '修改失败');
    setMessage('member-password-message', '密码修改成功');
    setTimeout(() => closeModalById('member-password-modal'), 500);
  } catch (error) {
    setMessage('member-password-message', error.message || '修改失败');
  } finally {
    btn.disabled = false;
  }
}

async function load2FAStatus() {
  const content = document.getElementById('member-2fa-content');
  if (!content) return;
  content.innerHTML = '<p class="brand-meta member-redeem-hint">正在加载 2FA 状态...</p>';
  try {
    const res = await fetch('/api/2fa/status', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '加载失败');
    if (data.enabled) {
      content.innerHTML = `
        <div class="member-2fa-card">
          <h4>两步验证已启用</h4>
          <p class="member-section-copy">你的账户当前已开启 2FA。你可以重新生成备用代码，或直接停用。</p>
          <div class="public-actions">
            <button class="btn btn-secondary" type="button" id="member-2fa-refresh-btn">重新生成备用代码</button>
            <button class="btn btn-primary" type="button" id="member-2fa-disable-btn">停用 2FA</button>
          </div>
          <div id="member-2fa-result" class="brand-meta member-redeem-hint"></div>
          <div id="member-2fa-backup-codes" class="member-2fa-code-grid"></div>
        </div>
      `;
      document.getElementById('member-2fa-refresh-btn')?.addEventListener('click', refresh2FABackupCodes);
      document.getElementById('member-2fa-disable-btn')?.addEventListener('click', disable2FA);
      return;
    }

    const setupRes = await fetch('/api/2fa/setup', { method: 'POST', credentials: 'same-origin' });
    const setupData = await setupRes.json().catch(() => ({}));
    if (!setupRes.ok) throw new Error(setupData.message || '初始化失败');
    content.innerHTML = `
      <div class="member-2fa-card">
        <h4>启用两步验证</h4>
        <p class="member-section-copy">使用验证器应用扫码，或复制完整连接手动导入后输入 6 位验证码完成启用。</p>
        <div class="member-2fa-qr">${setupData.qrCode ? `<img src="${setupData.qrCode}" alt="2FA QR">` : ''}</div>
        <div class="member-form-stack">
          <input class="member-form-input" type="text" value="${setupData.secret || ''}" readonly>
          <textarea id="member-2fa-uri" class="member-form-input" style="min-height:96px;padding:12px" readonly>${setupData.otpAuthUrl || ''}</textarea>
          <input id="member-2fa-token" class="member-form-input" type="text" placeholder="输入 6 位验证码" autocomplete="one-time-code">
        </div>
        <div class="public-actions" style="margin-top:12px">
          <button class="btn btn-secondary" type="button" id="member-2fa-copy-uri-btn">复制完整连接</button>
          <button class="btn btn-primary" type="button" id="member-2fa-enable-btn">启用 2FA</button>
        </div>
        <div id="member-2fa-result" class="brand-meta member-redeem-hint"></div>
      </div>
    `;
    document.getElementById('member-2fa-copy-uri-btn')?.addEventListener('click', async () => {
      const value = document.getElementById('member-2fa-uri')?.value || '';
      await navigator.clipboard.writeText(value);
      const result = document.getElementById('member-2fa-result');
      if (result) result.textContent = '完整连接已复制';
    });
    document.getElementById('member-2fa-enable-btn')?.addEventListener('click', enable2FA);
  } catch (error) {
    content.innerHTML = `<p class="brand-meta member-redeem-hint">${error.message || '加载失败'}</p>`;
  }
}

async function enable2FA() {
  const token = document.getElementById('member-2fa-token')?.value?.trim();
  const result = document.getElementById('member-2fa-result');
  if (!token || token.length !== 6) {
    if (result) result.textContent = '请输入 6 位验证码';
    return;
  }
  const res = await fetch('/api/2fa/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (result) result.textContent = data.message || '启用失败';
    return;
  }
  if (result) result.textContent = '2FA 已启用，已生成备用代码';
  const backupWrap = document.createElement('div');
  backupWrap.className = 'member-2fa-code-grid';
  backupWrap.innerHTML = (data.backupCodes || []).map((code) => `<div class="member-2fa-code">${code}</div>`).join('');
  document.getElementById('member-2fa-content')?.appendChild(backupWrap);
}

async function disable2FA() {
  const res = await fetch('/api/2fa/disable', { method: 'POST', credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  const result = document.getElementById('member-2fa-result');
  if (!res.ok) {
    if (result) result.textContent = data.message || '停用失败';
    return;
  }
  if (result) result.textContent = '2FA 已停用';
  setTimeout(() => load2FAStatus(), 400);
}

async function refresh2FABackupCodes() {
  const res = await fetch('/api/2fa/refresh-backup-codes', { method: 'POST', credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  const result = document.getElementById('member-2fa-result');
  const list = document.getElementById('member-2fa-backup-codes');
  if (!res.ok) {
    if (result) result.textContent = data.message || '生成失败';
    return;
  }
  if (result) result.textContent = '备用代码已重新生成';
  if (list) {
    list.innerHTML = (data.backupCodes || []).map((code) => `<div class="member-2fa-code">${code}</div>`).join('');
  }
}

async function logoutFromMemberPage() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    window.location.href = '/login.html';
  }
}

function renderQuotaGrid(userInfo) {
  const noteCount = Number(userInfo.noteCount || 0);
  const noteLimit = Number(userInfo.noteLimit || 100);
  const fileUsageMb = Number(userInfo.fileUsage || 0);
  const fileLimitMb = Number(userInfo.fileLimit || 0);
  const eventCount = Number(userInfo.eventCount || 0);
  const eventLimit = Number(userInfo.eventLimit || 500);
  const todoCount = Number(userInfo.todoCount || 0);
  const todoLimit = Number(userInfo.todoLimit || 500);
  const contactCount = Number(userInfo.contactCount || 0);
  const contactLimit = Number(userInfo.contactLimit || 500);
  const quotaProgressGrid = document.getElementById('quota-progress-grid');

  if (!quotaProgressGrid) return;

  const getPercent = (used, total) => {
    if (!total) return 0;
    return Math.min(100, Math.round((used / total) * 100));
  };
  const getBarClass = (percent) => percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : '';

  quotaProgressGrid.innerHTML = `
    <div class="quota-progress-item">
      <div class="quota-progress-header">
        <span>📝 笔记</span>
        <span class="quota-num">${noteCount} / ${noteLimit}</span>
      </div>
      <div class="quota-bar">
        <div class="quota-bar-fill ${getBarClass(getPercent(noteCount, noteLimit))}" style="width: ${getPercent(noteCount, noteLimit)}%"></div>
      </div>
    </div>
    <div class="quota-progress-item">
      <div class="quota-progress-header">
        <span>💾 存储空间</span>
        <span class="quota-num">${Math.round(fileUsageMb)}MB / ${Math.round(fileLimitMb)}MB</span>
      </div>
      <div class="quota-bar">
        <div class="quota-bar-fill ${getBarClass(getPercent(fileUsageMb, fileLimitMb))}" style="width: ${getPercent(fileUsageMb, fileLimitMb)}%"></div>
      </div>
    </div>
    <div class="quota-progress-item">
      <div class="quota-progress-header">
        <span>📅 日历事件</span>
        <span class="quota-num">${eventCount} / ${eventLimit}</span>
      </div>
      <div class="quota-bar">
        <div class="quota-bar-fill ${getBarClass(getPercent(eventCount, eventLimit))}" style="width: ${getPercent(eventCount, eventLimit)}%"></div>
      </div>
    </div>
    <div class="quota-progress-item">
      <div class="quota-progress-header">
        <span>✅ 待办</span>
        <span class="quota-num">${todoCount} / ${todoLimit}</span>
      </div>
      <div class="quota-bar">
        <div class="quota-bar-fill ${getBarClass(getPercent(todoCount, todoLimit))}" style="width: ${getPercent(todoCount, todoLimit)}%"></div>
      </div>
    </div>
    <div class="quota-progress-item">
      <div class="quota-progress-header">
        <span>👥 联系人</span>
        <span class="quota-num">${contactCount} / ${contactLimit}</span>
      </div>
      <div class="quota-bar">
        <div class="quota-bar-fill ${getBarClass(getPercent(contactCount, contactLimit))}" style="width: ${getPercent(contactCount, contactLimit)}%"></div>
      </div>
    </div>
  `;
}

function renderCapabilities(capabilities = {}) {
  const planCapabilityList = document.getElementById('plan-capability-list');
  if (!planCapabilityList) return;

  const capabilityRows = [
    ['笔记模块', capabilities.notesEnabled],
    ['日历模块', capabilities.calendarEnabled],
    ['待办模块', capabilities.todosEnabled],
    ['通讯录模块', capabilities.contactsEnabled],
    ['附件上传', capabilities.attachmentsEnabled],
    ['附件预览', capabilities.attachmentPreviewEnabled],
    ['附件管理', capabilities.attachmentManageEnabled],
    ['笔记分享', capabilities.noteSharingEnabled],
    ['附件分享', capabilities.fileSharingEnabled],
    ['导入导出', capabilities.importExport],
    ['备份导出', capabilities.backupExportEnabled],
    ['提醒中心', capabilities.remindersEnabled],
    ['邮件提醒', capabilities.emailRemindersEnabled],
    ['浏览器提醒', capabilities.browserRemindersEnabled],
    ['CalDAV 提醒', capabilities.caldavRemindersEnabled],
    ['日历订阅', capabilities.calendarSubscriptionsEnabled],
    ['WebDAV', capabilities.webdavEnabled],
    ['CalDAV', capabilities.caldavEnabled],
    ['CardDAV', capabilities.carddavEnabled],
    ['全局搜索', capabilities.searchEnabled],
    ['高级分享', capabilities.advancedSharing],
    ['团队协作', capabilities.teamWorkspace],
    ['管理后台', capabilities.adminWorkbench]
  ];

  planCapabilityList.innerHTML = capabilityRows.map(([label, enabled]) => `
    <div class="activity-item">
      <div class="activity-icon">${enabled ? '✅' : '⛔'}</div>
      <div class="activity-content">
        <div class="activity-title">${label}</div>
        <div class="activity-meta">${enabled ? '当前套餐已包含' : '当前套餐未开启'}</div>
      </div>
    </div>
  `).join('');
}

function renderModules(userInfo, capabilities = {}) {
  const modulesEntry = document.getElementById('modules-entry');
  if (!modulesEntry) return;

  const noteCount = Number(userInfo.noteCount || 0);
  const eventCount = Number(userInfo.eventCount || 0);
  const contactCount = Number(userInfo.contactCount || 0);
  const visibleModules = MEMBER_WORKSPACE_MODULES.filter((module) => (
    !module.capabilityKey || capabilities[module.capabilityKey] !== false
  ));

  modulesEntry.innerHTML = visibleModules.map((module) => {
    const idx = MEMBER_WORKSPACE_MODULES.indexOf(module);
    const icons = ['📝', '📅', '👥'];
    const links = ['/app', '/calendar.html', '/contacts.html'];
    const stats = [
      `${noteCount} 篇笔记`,
      `${eventCount} 个事件`,
      `${contactCount} 位联系人`
    ];

    return `
      <article class="module-entry-card">
        <div class="module-entry-icon">${icons[idx]}</div>
        <h4>${module.title}</h4>
        <p>${module.summary}</p>
        <div class="module-entry-stats">
          <div>
            <strong>${stats[idx].split(' ')[0]}</strong>
            <span>${stats[idx].split(' ')[1]}</span>
          </div>
        </div>
        <a class="module-entry-link" href="${links[idx]}">进入 →</a>
      </article>
    `;
  }).join('');
}

function renderQuickActions(capabilities = {}) {
  const quickActions = document.getElementById('quick-actions');
  if (!quickActions) return;

  const visibleQuickActions = MEMBER_QUICK_ACTIONS.filter((item) => (
    !item.capabilityKey || capabilities[item.capabilityKey] !== false
  ));

  quickActions.innerHTML = visibleQuickActions.map((item) => {
    const icon = item.href === '/app'
      ? '✏️'
      : item.href === '/calendar.html'
        ? '📆'
        : item.href === '/contacts.html'
          ? '➕'
          : '⬆️';

    return `
      <a class="quick-action-item" href="${item.href}">
        <div class="quick-action-icon">${icon}</div>
        <span class="quick-action-label">${item.title}</span>
      </a>
    `;
  }).join('');
}

function renderLoggedInState(userInfo) {
  if (!dashboardLoggedOut || !dashboardLoggedIn) return;

  dashboardLoggedOut.classList.add('site-hidden');
  dashboardLoggedIn.classList.remove('site-hidden');

  const tier = inferMemberTierFromUserInfo(userInfo);
  const username = userInfo.username || userInfo.user || '用户';
  const capabilities = userInfo.planCapabilities || {};

  const userAvatar = document.getElementById('user-avatar');
  const userWelcomeName = document.getElementById('user-welcome-name');
  const userPlanIcon = document.getElementById('user-plan-icon');
  const userPlanTagText = document.getElementById('user-plan-tag-text');
  const userJoinDate = document.getElementById('user-join-date');
  const userPlanExpiry = document.getElementById('user-plan-expiry');

  if (userAvatar) userAvatar.textContent = username.charAt(0).toUpperCase();
  if (userWelcomeName) userWelcomeName.textContent = `${username}，欢迎回来`;
  if (userPlanIcon) {
    userPlanIcon.textContent = tier.key === 'team' ? '🏢' : tier.key === 'pro' ? '⭐' : '🌱';
  }
  if (userPlanTagText) userPlanTagText.textContent = tier.name;
  if (userJoinDate && userInfo.createdAt) {
    const joinDate = new Date(userInfo.createdAt).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long'
    });
    userJoinDate.textContent = `加入于 ${joinDate}`;
  }
  if (userPlanExpiry) {
    if (Number(userInfo.planExpiresAt || 0) > 0) {
      const remainingDays = Number(userInfo.planRemainingDays || 0);
      const suffix = remainingDays > 0 ? ` · 剩余 ${remainingDays} 天` : '';
      userPlanExpiry.textContent = `有效至 ${new Date(Number(userInfo.planExpiresAt) * 1000).toLocaleDateString('zh-CN')}${suffix}`;
    } else {
      userPlanExpiry.textContent = '当前版本为长期有效';
    }
  }

  const memberAccountUsername = document.getElementById('member-account-username');
  const memberAccountEmail = document.getElementById('member-account-email');
  if (memberAccountUsername) memberAccountUsername.textContent = username;
  if (memberAccountEmail) memberAccountEmail.textContent = userInfo.email || '未绑定';

  renderQuotaGrid(userInfo);
  renderCapabilities(capabilities);
  renderModules(userInfo, capabilities);
  renderQuickActions(capabilities);
}

async function initMemberPage() {
  renderTierCategories();
  renderTiers(MEMBER_TIERS);
  loadMemberTiers().then((tiers) => {
    window.__memberPageTiers = tiers;
    renderTiers(tiers);
  }).catch(() => {});

  if (redeemCodeBtn) {
    redeemCodeBtn.addEventListener('click', redeemMemberCode);
  }

  if (redeemCodeInput) {
    redeemCodeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        redeemMemberCode();
      }
    });
  }

  memberOpenRedeemBtn?.addEventListener('click', () => openRedeemModal());
  upgradeBtn?.addEventListener('click', () => openRedeemModal());
  memberLogoutBtn?.addEventListener('click', logoutFromMemberPage);
  memberEmailBtn?.addEventListener('click', () => openModalById('member-email-modal'));
  memberPasswordBtn?.addEventListener('click', () => openModalById('member-password-modal'));
  member2FABtn?.addEventListener('click', async () => {
    openModalById('member-2fa-modal');
    await load2FAStatus();
  });
  document.getElementById('member-redeem-close-btn')?.addEventListener('click', closeRedeemModal);
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModalById(button.getAttribute('data-close-modal')));
  });
  memberRedeemModal?.addEventListener('click', (event) => {
    if (event.target === memberRedeemModal) closeRedeemModal();
  });
  document.querySelectorAll('.modal-shell').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal && modal.id !== 'member-redeem-modal') closeModalById(modal.id);
    });
  });
  memberRedeemModalBtn?.addEventListener('click', redeemMemberCode);
  document.getElementById('member-email-send-btn')?.addEventListener('click', sendBindCode);
  document.getElementById('member-email-verify-btn')?.addEventListener('click', verifyBindCode);
  document.getElementById('member-password-submit-btn')?.addEventListener('click', submitPasswordChange);
  memberRedeemModalInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      redeemMemberCode();
    }
  });

  try {
    const response = await fetch('/api/user-info', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return;
    const userInfo = await response.json();
    if (!userInfo) return;
    renderLoggedInState(userInfo);
  } catch {
    // Keep logged-out state if the session check fails.
  }
}

initMemberPage();
